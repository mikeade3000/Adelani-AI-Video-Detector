#!/usr/bin/env python3
"""Generate a QR code image (and optional terminal preview) for the phone URL
printed by server.py."""
import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Full phone URL printed by server.py, including ?token=...")
    parser.add_argument("--output", default="phone-qr.png", help="Output image filename")
    parser.add_argument("--terminal", action="store_true",
                        help="Also print an ASCII QR to the terminal")
    args = parser.parse_args()

    try:
        import qrcode
    except ImportError:
        sys.exit("Missing dependency. Install it with:\n    python -m pip install 'qrcode[pil]'")

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    qr.add_data(args.url)
    qr.make(fit=True)

    try:
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(args.output)
        print(f"QR saved to {args.output}")
    except Exception as exc:  # Pillow missing or image backend issue
        print(f"Could not save image ({exc}). Try: python -m pip install 'qrcode[pil]'")
        args.terminal = True

    if args.terminal:
        qr.print_ascii(invert=True)


if __name__ == "__main__":
    main()
