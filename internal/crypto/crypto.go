package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/user"

	"golang.org/x/crypto/pbkdf2"
)

const (
	cryptoSaltSize  = 32
	cryptoKeySize   = 32
	cryptoIterCount = 100_000
	// cryptoPepper is a fixed label; security derives from the random per-installation
	// salt stored in schema_meta, not from this value.
	cryptoPepper = "softdb-local-encryption-v2"
)

// GenerateSalt returns a cryptographically random 32-byte salt.
// Store the salt persistently (e.g., in schema_meta) and derive the key with DeriveKeyFromSalt.
func GenerateSalt() ([]byte, error) {
	salt := make([]byte, cryptoSaltSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, fmt.Errorf("crypto: generate salt: %w", err)
	}
	return salt, nil
}

// DeriveKeyFromSalt derives a 32-byte AES-256 key from a random salt via PBKDF2-SHA256.
// The pepper is a fixed application label; the random machine-local salt is the actual secret.
func DeriveKeyFromSalt(salt []byte) []byte {
	return pbkdf2.Key([]byte(cryptoPepper), salt, cryptoIterCount, cryptoKeySize, sha256.New)
}

// EncryptWithKey encrypts plaintext using AES-256-GCM with the provided 32-byte key.
// Returns a base64-encoded string (nonce || ciphertext). Empty plaintext returns empty string.
func EncryptWithKey(plaintext string, key []byte) (string, error) {
	if plaintext == "" {
		return "", nil
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: create GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("crypto: generate nonce: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// DecryptWithKey decrypts a base64-encoded AES-256-GCM ciphertext with the provided 32-byte key.
// Returns an explicit error on any failure — never silently returns the original input as plaintext.
func DecryptWithKey(encoded string, key []byte) (string, error) {
	if encoded == "" {
		return "", nil
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("crypto: decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("crypto: ciphertext too short (%d bytes, need >%d)", len(ciphertext), nonceSize)
	}

	nonce, data := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, data, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: decrypt failed: %w", err)
	}

	return string(plaintext), nil
}

// LegacyDecrypt attempts to decrypt using the old SHA256(hostname+username) key.
// Returns an explicit error on failure — never silently returns the original input.
// Use only during data migration from the old key derivation scheme.
func LegacyDecrypt(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy decode: %w", err)
	}

	key := legacyDeriveKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("crypto: legacy ciphertext too short")
	}

	nonce, data := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, data, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy decrypt failed: %w", err)
	}

	return string(plaintext), nil
}

// LegacyEncrypt encrypts with the old SHA256(hostname+username) key.
// Exposed for testing migration scenarios only — do NOT use for new encryption.
func LegacyEncrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}

	key := legacyDeriveKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: legacy GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("crypto: legacy nonce: %w", err)
	}

	ct := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// legacyDeriveKey computes the old SHA256(hostname+username) key.
// Internal use only; kept solely for migration.
func legacyDeriveKey() []byte {
	hostname, _ := os.Hostname()
	u, _ := user.Current()
	username := ""
	if u != nil {
		username = u.Username
	}
	seed := fmt.Sprintf("softdb:%s:%s", hostname, username)
	hash := sha256.Sum256([]byte(seed))
	return hash[:]
}
