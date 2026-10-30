# Android APK updates without uninstalling

The APK workflow uses the same Android application ID (`com.dentalclinic.os`) and assigns a higher `versionCode` to each build. Android can install an APK over an existing installation only when the signing certificate also matches.

## One-time setup: keep the debug signing key stable

The GitHub Actions runner is temporary. Without a persistent key, each generated debug APK can be signed with a different key and Android will reject it as an update. Do not download/install a candidate APK until this secret is configured.

On a computer with Java's `keytool` installed, open PowerShell in a private folder and create a persistent debug keystore:

```powershell
keytool -genkeypair -v -keystore .\dental-clinic-debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Dental Clinic OS, OU=App, O=Private, L=Cairo, ST=Cairo, C=EG"
```

Keep `dental-clinic-debug.keystore` backed up somewhere private and safe. Never commit or upload the keystore file itself to the repository.

Convert it to Base64 in PowerShell and copy the result:

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes(".\dental-clinic-debug.keystore"))
Set-Clipboard $b64
```

In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `ANDROID_DEBUG_KEYSTORE_BASE64`
- Secret: paste the Base64 value from the clipboard.

The workflow expects this keystore to use alias `androiddebugkey`, store password `android`, and key password `android`, matching the Android debug signing configuration. The Base64 secret is private; do not paste it into chat or a commit.

## Important first-install transition

An APK already installed from an earlier temporary GitHub runner may have a different signing certificate. Android cannot update that installation with the new key. Back up/export local clinic data first and verify the backup before any transition. If Android reports a signature mismatch, a one-time uninstall/reinstall may be unavoidable; uninstalling can erase local-only data, so do not proceed until that data is safely backed up. Once the stable key is used for the installed app, future APKs from this workflow should install as updates as long as the application ID stays the same and versionCode increases.

This is a debug APK workflow, not a Play Store production-signing setup. Keep the signing key private.
