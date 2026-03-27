package tunnel

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"io"
	"net"
	"strconv"
	"testing"

	"golang.org/x/crypto/ssh"
)

const testSSHPassword = "s3cr3t_tunnel_pw"

func TestNewSSHTunnelDefaultPort(t *testing.T) {
	tun := NewSSHTunnel(SSHTunnelConfig{Host: "example.com", User: "u", Password: "p"})
	if tun.config.Port != 22 {
		t.Errorf("expected default port 22, got %d", tun.config.Port)
	}
}

func TestNewSSHTunnelExplicitPort(t *testing.T) {
	tun := NewSSHTunnel(SSHTunnelConfig{Port: 2222})
	if tun.config.Port != 2222 {
		t.Errorf("expected port 2222, got %d", tun.config.Port)
	}
}

func TestCloseIdempotent(t *testing.T) {
	tun := NewSSHTunnel(SSHTunnelConfig{})
	for i := range 5 {
		if err := tun.Close(); err != nil {
			t.Errorf("Close() call %d returned error: %v", i+1, err)
		}
	}
}

func TestBuildAuthMethodsNoAuth(t *testing.T) {
	_, err := buildAuthMethods(SSHTunnelConfig{})
	if err == nil {
		t.Error("expected error for config with no auth methods, got nil")
	}
}

func TestBuildAuthMethodsPassword(t *testing.T) {
	methods, err := buildAuthMethods(SSHTunnelConfig{Password: "pw"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(methods) != 1 {
		t.Errorf("expected 1 auth method, got %d", len(methods))
	}
}

func TestBuildAuthMethodsMissingKeyFile(t *testing.T) {
	_, err := buildAuthMethods(SSHTunnelConfig{PrivateKeyPath: "/nonexistent/key.pem"})
	if err == nil {
		t.Error("expected error for missing key file, got nil")
	}
}

func TestBuildAuthMethodsBothPasswordAndKey(t *testing.T) {
	tun := NewSSHTunnel(SSHTunnelConfig{Password: "pw", PrivateKeyPath: "/nonexistent"})
	if tun.config.Password == "" {
		t.Error("password should be preserved")
	}
	if tun.config.PrivateKeyPath == "" {
		t.Error("key path should be preserved")
	}
}

func TestSSHTunnelFullFlow(t *testing.T) {
	echoAddr := startEchoServer(t)
	sshHost, sshPort := startTestSSHServer(t)

	tun := NewSSHTunnel(SSHTunnelConfig{
		Host:       sshHost,
		Port:       sshPort,
		User:       "testuser",
		Password:   testSSHPassword,
		RemoteHost: echoAddr.IP.String(),
		RemotePort: echoAddr.Port,
	})

	localPort, err := tun.Start()
	if err != nil {
		t.Fatalf("tunnel Start: %v", err)
	}
	t.Cleanup(func() { tun.Close() })

	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		t.Fatalf("connect to tunnel: %v", err)
	}
	defer conn.Close()

	msg := []byte("hello tunnel")
	if _, err := conn.Write(msg); err != nil {
		t.Fatalf("write: %v", err)
	}

	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read echo: %v", err)
	}
	if string(buf) != string(msg) {
		t.Errorf("echo mismatch: got %q, want %q", string(buf), string(msg))
	}
}

func TestSSHTunnelCloseAfterStart(t *testing.T) {
	_, sshPort := startTestSSHServer(t)

	tun := NewSSHTunnel(SSHTunnelConfig{
		Host:       "127.0.0.1",
		Port:       sshPort,
		User:       "testuser",
		Password:   testSSHPassword,
		RemoteHost: "127.0.0.1",
		RemotePort: 1,
	})

	localPort, err := tun.Start()
	if err != nil {
		t.Fatalf("tunnel Start: %v", err)
	}
	if localPort == 0 {
		t.Error("expected non-zero local port after Start")
	}
	if tun.LocalPort() != localPort {
		t.Errorf("LocalPort() = %d, want %d", tun.LocalPort(), localPort)
	}

	if err := tun.Close(); err != nil {
		t.Errorf("Close() returned error: %v", err)
	}
	if err := tun.Close(); err != nil {
		t.Errorf("second Close() returned error: %v", err)
	}
}

func startEchoServer(t *testing.T) *net.TCPAddr {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("echo server listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go io.Copy(c, c) //nolint:errcheck
		}
	}()
	return ln.Addr().(*net.TCPAddr)
}

func startTestSSHServer(t *testing.T) (host string, port int) {
	t.Helper()

	hostKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(hostKey)
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}

	serverCfg := &ssh.ServerConfig{
		PasswordCallback: func(_ ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == testSSHPassword {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid password")
		},
	}
	serverCfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("ssh server listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleTestSSHConn(conn, serverCfg)
		}
	}()

	addr := ln.Addr().(*net.TCPAddr)
	return addr.IP.String(), addr.Port
}

func handleTestSSHConn(conn net.Conn, cfg *ssh.ServerConfig) {
	srvConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer srvConn.Close()
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "direct-tcpip" {
			newChan.Reject(ssh.UnknownChannelType, "unsupported") //nolint:errcheck
			continue
		}
		go forwardTestDirectTCPIP(newChan)
	}
}

// directTCPIPPayload is the RFC 4254 §7.2 direct-tcpip channel open payload.
type directTCPIPPayload struct {
	DestAddr   string
	DestPort   uint32
	OriginAddr string
	OriginPort uint32
}

func forwardTestDirectTCPIP(newChan ssh.NewChannel) {
	var payload directTCPIPPayload
	if err := ssh.Unmarshal(newChan.ExtraData(), &payload); err != nil {
		newChan.Reject(ssh.ConnectionFailed, "bad payload") //nolint:errcheck
		return
	}

	ch, reqs, err := newChan.Accept()
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	defer ch.Close()

	dest := net.JoinHostPort(payload.DestAddr, strconv.FormatUint(uint64(payload.DestPort), 10))
	remote, err := net.Dial("tcp", dest)
	if err != nil {
		return
	}
	defer remote.Close()

	done := make(chan struct{}, 2)
	go func() { io.Copy(remote, ch); done <- struct{}{} }() //nolint:errcheck
	go func() { io.Copy(ch, remote); done <- struct{}{} }() //nolint:errcheck
	<-done
}
