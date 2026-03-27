// Package tunnel provides SSH port-forwarding tunnels for database connections.
// Only single-hop (direct) tunnels are supported in v1.
package tunnel

import (
	"fmt"
	"io"
	"net"
	"os"
	"sync"

	"golang.org/x/crypto/ssh"
)

// SSHTunnelConfig holds the parameters needed to establish an SSH tunnel.
type SSHTunnelConfig struct {
	Host           string // SSH server hostname or IP
	Port           int    // SSH server port (default: 22)
	User           string // SSH login username
	Password       string // Password auth (optional if PrivateKeyPath is set)
	PrivateKeyPath string // Path to PEM/OpenSSH private key file (optional)
	RemoteHost     string // Target host reachable from the SSH server
	RemotePort     int    // Target port reachable from the SSH server
}

// SSHTunnel manages a local TCP listener that forwards connections through an
// SSH server to RemoteHost:RemotePort.
type SSHTunnel struct {
	config        SSHTunnelConfig
	sshClient     *ssh.Client
	localListener net.Listener
	localPort     int
	done          chan struct{}
	once          sync.Once
}

// NewSSHTunnel creates a new SSHTunnel from the given config.
// If Port is 0 it defaults to 22.
func NewSSHTunnel(config SSHTunnelConfig) *SSHTunnel {
	if config.Port == 0 {
		config.Port = 22
	}
	return &SSHTunnel{
		config: config,
		done:   make(chan struct{}),
	}
}

// Start dials the SSH server, opens a local listener on a random port on
// 127.0.0.1, and begins accepting connections in the background.
// It returns the local port number that forwards to RemoteHost:RemotePort.
func (t *SSHTunnel) Start() (localPort int, err error) {
	authMethods, err := buildAuthMethods(t.config)
	if err != nil {
		return 0, err
	}

	clientConfig := &ssh.ClientConfig{
		User:            t.config.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // v1: no host-key validation
	}

	sshAddr := fmt.Sprintf("%s:%d", t.config.Host, t.config.Port)
	client, err := ssh.Dial("tcp", sshAddr, clientConfig)
	if err != nil {
		return 0, fmt.Errorf("tunnel: connect to SSH server %s: %w", sshAddr, err)
	}
	t.sshClient = client

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		return 0, fmt.Errorf("tunnel: start local listener: %w", err)
	}
	t.localListener = listener
	t.localPort = listener.Addr().(*net.TCPAddr).Port

	go t.serve()
	return t.localPort, nil
}

// LocalPort returns the local port used by the tunnel. Valid only after Start.
func (t *SSHTunnel) LocalPort() int {
	return t.localPort
}

// Close shuts down the tunnel — stops the local listener and closes the SSH
// client. Safe to call multiple times or on an unstarted tunnel.
func (t *SSHTunnel) Close() error {
	var firstErr error
	t.once.Do(func() {
		close(t.done)
		if t.localListener != nil {
			if err := t.localListener.Close(); err != nil {
				firstErr = err
			}
		}
		if t.sshClient != nil {
			if err := t.sshClient.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	})
	return firstErr
}

// serve accepts local connections and spawns a forward goroutine for each.
func (t *SSHTunnel) serve() {
	for {
		localConn, err := t.localListener.Accept()
		if err != nil {
			// Listener was closed (via Close); stop accepting.
			return
		}
		go t.forward(localConn)
	}
}

// forward bridges a single local TCP connection to RemoteHost:RemotePort through
// the SSH client using a direct-tcpip channel.
func (t *SSHTunnel) forward(localConn net.Conn) {
	defer localConn.Close()

	remoteAddr := fmt.Sprintf("%s:%d", t.config.RemoteHost, t.config.RemotePort)
	remoteConn, err := t.sshClient.Dial("tcp", remoteAddr)
	if err != nil {
		return
	}
	defer remoteConn.Close()

	// Bidirectional copy — exit when either direction closes.
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(remoteConn, localConn) //nolint:errcheck
		done <- struct{}{}
	}()
	go func() {
		io.Copy(localConn, remoteConn) //nolint:errcheck
		done <- struct{}{}
	}()
	<-done
}

// buildAuthMethods constructs SSH auth methods from the given config.
// Returns an error when neither a password nor a private-key path is set.
func buildAuthMethods(cfg SSHTunnelConfig) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	if cfg.Password != "" {
		methods = append(methods, ssh.Password(cfg.Password))
	}

	if cfg.PrivateKeyPath != "" {
		keyData, err := os.ReadFile(cfg.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("tunnel: read private key %q: %w", cfg.PrivateKeyPath, err)
		}
		signer, err := ssh.ParsePrivateKey(keyData)
		if err != nil {
			return nil, fmt.Errorf("tunnel: parse private key %q: %w", cfg.PrivateKeyPath, err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if len(methods) == 0 {
		return nil, fmt.Errorf("tunnel: at least one auth method (password or private key) is required")
	}

	return methods, nil
}
