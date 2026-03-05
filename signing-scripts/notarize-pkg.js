/**
 * electron-builder afterAllArtifactBuild hook
 * 
 * Notarizes .pkg and .dmg installer artifacts after they are built.
 * The .app bundle is already notarized by electron-builder's built-in notarize option.
 * However, .pkg installers need to be separately notarized and stapled.
 * 
 * This script uses the APPLE_KEYCHAIN_PROFILE env var for authentication
 * (same keychain profile used for the .app notarization).
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

async function afterAllArtifactBuild(buildResult) {
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;

  if (!keychainProfile) {
    console.log("\n⚠️  APPLE_KEYCHAIN_PROFILE not set — skipping PKG/DMG notarization\n");
    return [];
  }

  // Filter for .pkg and .dmg files that need notarization
  const artifactsToNotarize = (buildResult.artifactPaths || []).filter((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    return (ext === ".pkg" || ext === ".dmg") && fs.existsSync(filePath);
  });

  if (artifactsToNotarize.length === 0) {
    console.log("\nNo .pkg or .dmg artifacts found to notarize.\n");
    return [];
  }

  for (const artifactPath of artifactsToNotarize) {
    const fileName = path.basename(artifactPath);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Notarizing: ${fileName}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      // Submit for notarization and wait
      console.log("Submitting to Apple notary service (this may take several minutes)...\n");
      execSync(
        `xcrun notarytool submit "${artifactPath}" --keychain-profile "${keychainProfile}" --wait`,
        { stdio: "inherit" }
      );

      console.log("\n✅ Notarization successful!");

      // Staple the notarization ticket
      console.log("Stapling notarization ticket...\n");
      execSync(`xcrun stapler staple "${artifactPath}"`, { stdio: "inherit" });

      console.log(`\n✅ ${fileName} is notarized and stapled!\n`);
    } catch (error) {
      console.error(`\n❌ Failed to notarize ${fileName}`);
      console.error(error.message);
      throw error;
    }
  }

  return [];
}

module.exports = afterAllArtifactBuild;
