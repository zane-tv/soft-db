package crypto

import (
	"errors"
	"strings"
	"testing"
)

func TestEncryptWithPassphraseAndDecryptWithPassphrase(t *testing.T) {
	tests := []struct {
		name           string
		plaintext      string
		encryptKey     string
		decryptKey     string
		wantPlaintext  string
		wantEncryptErr error
		wantDecryptErr string
	}{
		{
			name:          "round trip plain text",
			plaintext:     "super secret password",
			encryptKey:    "portable-passphrase",
			decryptKey:    "portable-passphrase",
			wantPlaintext: "super secret password",
		},
		{
			name:           "wrong passphrase fails",
			plaintext:      "super secret password",
			encryptKey:     "portable-passphrase",
			decryptKey:     "wrong-passphrase",
			wantDecryptErr: "decrypt with passphrase",
		},
		{
			name:           "empty passphrase on encrypt",
			plaintext:      "super secret password",
			wantEncryptErr: ErrEmptyPassphrase,
		},
		{
			name:          "empty plaintext works",
			plaintext:     "",
			encryptKey:    "portable-passphrase",
			decryptKey:    "portable-passphrase",
			wantPlaintext: "",
		},
		{
			name:           "empty passphrase on decrypt",
			plaintext:      "super secret password",
			encryptKey:     "portable-passphrase",
			wantDecryptErr: ErrEmptyPassphrase.Error(),
		},
		{
			name:           "invalid base64 fails",
			plaintext:      "ignored",
			decryptKey:     "portable-passphrase",
			wantDecryptErr: "decode ciphertext",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ciphertext := "not-base64!!!"
			if tt.encryptKey != "" || tt.wantEncryptErr != nil {
				var err error
				ciphertext, err = EncryptWithPassphrase(tt.plaintext, tt.encryptKey)
				if !errors.Is(err, tt.wantEncryptErr) {
					t.Fatalf("EncryptWithPassphrase() error = %v, want %v", err, tt.wantEncryptErr)
				}
				if err != nil {
					return
				}
				if ciphertext == "" {
					t.Fatal("EncryptWithPassphrase() returned empty ciphertext")
				}
			}

			plaintext, err := DecryptWithPassphrase(ciphertext, tt.decryptKey)
			if tt.wantDecryptErr != "" {
				if err == nil {
					t.Fatalf("DecryptWithPassphrase() error = nil, want %q", tt.wantDecryptErr)
				}
				if !strings.Contains(err.Error(), tt.wantDecryptErr) {
					t.Fatalf("DecryptWithPassphrase() error = %q, want substring %q", err.Error(), tt.wantDecryptErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecryptWithPassphrase() error = %v", err)
			}
			if plaintext != tt.wantPlaintext {
				t.Fatalf("DecryptWithPassphrase() = %q, want %q", plaintext, tt.wantPlaintext)
			}
		})
	}
}

func TestEncryptWithPassphraseDifferentPassphrasesProduceDifferentCiphertexts(t *testing.T) {
	plaintext := "super secret password"

	first, err := EncryptWithPassphrase(plaintext, "passphrase-one")
	if err != nil {
		t.Fatalf("EncryptWithPassphrase() first error = %v", err)
	}

	second, err := EncryptWithPassphrase(plaintext, "passphrase-two")
	if err != nil {
		t.Fatalf("EncryptWithPassphrase() second error = %v", err)
	}

	if first == second {
		t.Fatal("EncryptWithPassphrase() produced identical ciphertexts for different passphrases")
	}
}

func TestEncryptWithPassphraseSameInputsProduceDifferentCiphertexts(t *testing.T) {
	plaintext := "super secret password"
	passphrase := "portable-passphrase"

	first, err := EncryptWithPassphrase(plaintext, passphrase)
	if err != nil {
		t.Fatalf("EncryptWithPassphrase() first error = %v", err)
	}

	second, err := EncryptWithPassphrase(plaintext, passphrase)
	if err != nil {
		t.Fatalf("EncryptWithPassphrase() second error = %v", err)
	}

	if first == second {
		t.Fatal("EncryptWithPassphrase() produced identical ciphertexts for same input")
	}
}
