// Resolve the SDK-matched plugin API through our declared Expo dependency.
// Direct transitive imports are not available under pnpm's isolated layout.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Static app.json remains authoritative across every clean Expo prebuild.
module.exports = function withOfflineAndroid(config) {
  config = withAndroidManifest(config, result => {
    const application = result.modResults.manifest.application[0];
    // Preserve support for user-selected HTTP self-hosted servers. HTTPS is
    // recommended; this is not an automatic downgrade of an HTTPS connection.
    application.$['android:usesCleartextTraffic'] = 'true';
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/memex_offline_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/memex_offline_data_extraction_rules';
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const directory = path.join(result.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    const exclusions = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref']
      .map(domain => `<exclude domain="${domain}" path="."/>`).join('');
    await fs.writeFile(path.join(directory, 'memex_offline_backup_rules.xml'), `<full-backup-content>${exclusions}</full-backup-content>`);
    await fs.writeFile(path.join(directory, 'memex_offline_data_extraction_rules.xml'),
      `<data-extraction-rules><cloud-backup>${exclusions}</cloud-backup><device-transfer>${exclusions}</device-transfer></data-extraction-rules>`);
    return result;
  }]);
};
