package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/pbkdf2"
)

const (
	passphraseSaltSize = 16
	passphraseKeySize  = 32
	passphraseIters    = 100000
)

var ErrEmptyPassphrase = errors.New("empty passphrase")

// EncryptWithPassphrase encrypts plaintext using AES-256-GCM with a passphrase-derived key.
// Returns a base64-encoded string containing salt + nonce + ciphertext.
func EncryptWithPassphrase(plaintext string, passphrase string) (string, error) {
	if passphrase == "" {
		return "", ErrEmptyPassphrase
	}

	salt := make([]byte, passphraseSaltSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("crypto: generate salt: %w", err)
	}

	key := pbkdf2.Key([]byte(passphrase), salt, passphraseIters, passphraseKeySize, sha256.New)
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

	sealed := aesGCM.Seal(nil, nonce, []byte(plaintext), nil)
	payload := make([]byte, 0, len(salt)+len(nonce)+len(sealed))
	payload = append(payload, salt...)
	payload = append(payload, nonce...)
	payload = append(payload, sealed...)

	return base64.StdEncoding.EncodeToString(payload), nil
}

// DecryptWithPassphrase decrypts a base64-encoded salt + nonce + ciphertext payload.
func DecryptWithPassphrase(ciphertext string, passphrase string) (string, error) {
	if passphrase == "" {
		return "", ErrEmptyPassphrase
	}

	payload, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("crypto: decode ciphertext: %w", err)
	}

	if len(payload) < passphraseSaltSize {
		return "", errors.New("crypto: ciphertext too short")
	}

	salt := payload[:passphraseSaltSize]
	key := pbkdf2.Key([]byte(passphrase), salt, passphraseIters, passphraseKeySize, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(payload) < passphraseSaltSize+nonceSize {
		return "", errors.New("crypto: ciphertext too short")
	}

	nonceStart := passphraseSaltSize
	nonceEnd := nonceStart + nonceSize
	nonce := payload[nonceStart:nonceEnd]
	sealed := payload[nonceEnd:]

	plaintext, err := aesGCM.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: decrypt with passphrase: %w", err)
	}

	return string(plaintext), nil
}
