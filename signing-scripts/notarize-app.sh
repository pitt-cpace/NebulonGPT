#!/bin/bash

# Script to notarize and staple NebulonGPT app or PKG installer
# Usage: ./notarize-app.sh [arm64|x64]

set -e

ARCH="$1"

# Validate required parameters
if [ -z "$ARCH" ]; then
    echo "Error: Architecture parameter required"
    echo "Usage: $0 [arm64|x64]"
    exit 1
fi

# Validate architecture
if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x64" ]; then
    echo "Invalid architecture: $ARCH"
    echo "Usage: $0 [arm64|x64]"
    exit 1
fi

echo "Architecture: $ARCH"
echo ""

# Determine the project root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

KEYCHAIN_PROFILE="AC_PROFILE"

# Check for PKG file first
PKG_FILE="${PROJECT_ROOT}/dist-electron/NebulonGPT-0.1.0-${ARCH}.pkg"

if [ -f "$PKG_FILE" ]; then
    # PKG workflow: submit directly, no zipping needed
    echo "Found PKG installer: $PKG_FILE"
    PKG_SIZE=$(du -h "$PKG_FILE" | cut -f1)
    echo "Size: $PKG_SIZE"
    echo ""
    
    echo "Submitting PKG to Apple notary service..."
    echo "This may take several minutes..."
    echo ""
    
    # Submit for notarization and wait
    xcrun notarytool submit "$PKG_FILE" \
        --keychain-profile "$KEYCHAIN_PROFILE" \
        --wait
    
    NOTARY_EXIT_CODE=$?
    
    echo ""
    
    if [ $NOTARY_EXIT_CODE -ne 0 ]; then
        echo "Error: Notarization failed!"
        echo ""
        echo "To view the detailed log, get the Submission ID from above and run:"
        echo "  xcrun notarytool log <submission-id> --keychain-profile \"$KEYCHAIN_PROFILE\""
        exit 1
    fi
    
    echo "Notarization successful!"
    echo ""
    
    echo "Stapling notarization ticket to PKG..."
    
    xcrun stapler staple "$PKG_FILE"
    
    STAPLE_EXIT_CODE=$?
    
    echo ""
    
    if [ $STAPLE_EXIT_CODE -ne 0 ]; then
        echo "Error: Stapling failed!"
        exit 1
    fi
    
    echo "Stapling successful!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Success! Your PKG installer is notarized and stapled."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "PKG location: $PKG_FILE"
    echo ""
    echo "You can now distribute this installer. It will be trusted by Gatekeeper."
    echo ""

else
    # APP workflow: zip, submit, staple to .app
    # Define paths based on architecture
    # electron-builder uses "mac" for x64 and "mac-arm64" for arm64
    if [ "$ARCH" = "arm64" ]; then
        BUILD_DIR="mac-arm64"
    else
        BUILD_DIR="mac"
    fi

    APP_DIR="${PROJECT_ROOT}/dist-electron/${BUILD_DIR}/NebulonGPT.app"
    ZIP_FILE="${PROJECT_ROOT}/dist-electron/${BUILD_DIR}/NebulonGPT.zip"

    # Check if app exists
    if [ ! -d "$APP_DIR" ]; then
        echo "Error: Neither PKG nor APP found"
        echo ""
        echo "PKG checked: $PKG_FILE"
        echo "APP checked: $APP_DIR"
        echo ""
        echo "Please build first:"
        echo "  npm run dist:mac-pkg-${ARCH}  (for PKG)"
        echo "  npm run dist:mac-dmg-${ARCH}  (for DMG/APP)"
        exit 1
    fi

    echo "Found APP bundle: $APP_DIR"
    echo ""

    # Remove old zip if exists
    if [ -f "$ZIP_FILE" ]; then
        rm "$ZIP_FILE"
        echo "Removed old zip file"
    fi

    # Create zip using ditto (preserves code signing)
    ditto -c -k --keepParent "$APP_DIR" "$ZIP_FILE"

    if [ ! -f "$ZIP_FILE" ]; then
        echo "Error: Failed to create zip file"
        exit 1
    fi

    ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
    echo "Zip created successfully (Size: $ZIP_SIZE)"
    echo ""

    echo "Submitting to Apple notary service..."
    echo "This may take several minutes..."
    echo ""

    # Submit for notarization and wait
    xcrun notarytool submit "$ZIP_FILE" \
        --keychain-profile "$KEYCHAIN_PROFILE" \
        --wait

    NOTARY_EXIT_CODE=$?

    echo ""

    if [ $NOTARY_EXIT_CODE -ne 0 ]; then
        echo "Error: Notarization failed!"
        echo ""
        echo "To view the detailed log, get the Submission ID from above and run:"
        echo "  xcrun notarytool log <submission-id> --keychain-profile \"$KEYCHAIN_PROFILE\""
        exit 1
    fi

    echo "Notarization successful!"
    echo ""

    echo "Stapling notarization ticket..."

    xcrun stapler staple "$APP_DIR"

    STAPLE_EXIT_CODE=$?

    echo ""

    if [ $STAPLE_EXIT_CODE -ne 0 ]; then
        echo "Error: Stapling failed!"
        exit 1
    fi

    echo "Stapling successful!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Success! Your app is notarized and stapled."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "App location: $APP_DIR"
    echo ""
    echo "You can now distribute this app. It will be trusted by Gatekeeper."
    echo ""
fi
