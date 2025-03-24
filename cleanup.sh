#!/bin/bash

# Nebulon-GPT Cleanup Script
# This script removes unnecessary files and directories to reduce the app's size
# while ensuring it remains fully functional.

echo "Starting Nebulon-GPT cleanup..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "Error: package.json not found. Please run this script from the Nebulon-GPT directory."
  exit 1
fi

# Calculate initial size
INITIAL_SIZE=$(du -sh . | cut -f1)
echo "Initial size: $INITIAL_SIZE"

# Remove any build directories if they exist
if [ -d "build" ]; then
  echo "Removing build directory..."
  rm -rf build
fi

if [ -d "dist" ]; then
  echo "Removing dist directory..."
  rm -rf dist
fi

# Remove any test files/directories if they exist
if [ -d "__tests__" ]; then
  echo "Removing __tests__ directory..."
  rm -rf __tests__
fi

if [ -d "tests" ]; then
  echo "Removing tests directory..."
  rm -rf tests
fi

# Remove any documentation directories
if [ -d "docs" ]; then
  echo "Removing docs directory..."
  rm -rf docs
fi

# Remove any example directories
if [ -d "examples" ]; then
  echo "Removing examples directory..."
  rm -rf examples
fi

# Clean up node_modules - remove unnecessary files from dependencies
echo "Cleaning up node_modules..."

# Remove documentation, tests, and examples from node_modules
find node_modules -type d -name "docs" -o -name "doc" -o -name "documentation" | xargs rm -rf
find node_modules -type d -name "test" -o -name "tests" -o -name "__tests__" | xargs rm -rf
find node_modules -type d -name "example" -o -name "examples" | xargs rm -rf

# Remove source maps from node_modules
find node_modules -name "*.map" -type f -delete

# Remove TypeScript source files (keep only compiled JS)
find node_modules -name "*.ts" -not -name "*.d.ts" -type f -delete

# Remove markdown files
find node_modules -name "*.md" -type f -delete

# Remove license files
find node_modules -name "LICENSE*" -type f -delete
find node_modules -name "license*" -type f -delete

# Remove any git directories
find node_modules -name ".git" -type d | xargs rm -rf

# Remove the cache directory which contains large build artifacts
if [ -d "node_modules/.cache" ]; then
  echo "Removing node_modules/.cache directory..."
  rm -rf node_modules/.cache
fi

# Remove specific large files that are not needed for the app to function
echo "Removing specific large files..."
rm -f node_modules/typescript/lib/tsserverlibrary.js
rm -f node_modules/typescript/lib/tsserver.js

echo "NOTE: To further reduce the app size, you can build the app for production and then remove development dependencies:"
echo "  1. npm run build"
echo "  2. npm prune --production"
echo "This will create a production build in the 'build' directory and remove all development dependencies."
echo "However, after doing this, you won't be able to run the development server or make changes to the code."

# Calculate final size
FINAL_SIZE=$(du -sh . | cut -f1)
echo "Initial size: $INITIAL_SIZE"
echo "Final size: $FINAL_SIZE"
echo "Cleanup complete!"

echo "You can now run the app in development mode with: npm start"
echo "Or build for production with: npm run build"
