GitStar Installation Guide
==========================

Version 1.0.4
-------------
Paste from the right-click menu no longer asks for permission to read
the clipboard, and the About dialog links to the website.

Since 1.0.3: Settings is split into tabs (Git, SSH / Authentication,
Appearance, AI, Update). Changes made on the wrong branch can be
committed to another branch from the commit box ("Other branch...").
For the update server, the server address is enough
(https://www.c64va.pro/).

The main-window Donate button appears after 10 minutes of foreground
use. The timer pauses while the window is unfocused or hidden and
resets each time GitStar starts. You can also donate from the About
dialog at any time.

See whatsnew.txt for the release history.

Download
--------
On the GitHub Actions page for a successful "Build installers" run,
download the ZIP for your platform from Artifacts and extract it.

GitStar uses the Git executable installed on your computer. Run
"git --version" in a terminal to check that Git is available. If GitStar
was already open when you installed Git, close and reopen it.

Windows x64 and ARM64
---------------------
1. Open Settings > System > About and check System type.
2. For an x64 processor, choose the NSIS .exe from the
   GitStar-x86_64-pc-windows-msvc artifact. For an ARM processor, choose
   the .exe from GitStar-aarch64-pc-windows-msvc.
3. Install the appropriate Git for Windows build from https://git-scm.com/.
   Allow Git to be used by third-party software during setup so GitStar
   can find it.
4. Run the GitStar .exe installer. If the WebView2 Runtime is missing,
   the installer downloads it, which requires an internet connection.
   SmartScreen may warn about the unsigned installer. If you have
   verified the download source, select "More info" and then "Run anyway"
   if Windows offers that option.
5. Open GitStar from the Start menu.

macOS Apple Silicon (ARM64) and Intel (x64)
------------------------------------------
1. Open Apple menu > About This Mac and check the chip or processor.
   For an Apple M-series chip, choose the .dmg from
   GitStar-aarch64-apple-darwin. For an Intel processor, choose the .dmg
   from GitStar-x86_64-apple-darwin.
2. If "git --version" prompts you to install the developer tools, accept
   the prompt or start the installer with "xcode-select --install".
3. Open the .dmg, drag GitStar.app into Applications, and eject the disk
   image.
4. Open GitStar from Applications. If Gatekeeper blocks the app because
   the developer cannot be verified, check the download source. After
   the first launch attempt, open System Settings > Privacy & Security,
   choose "Open Anyway" if available, and confirm.
   Apple guide: https://support.apple.com/en-ie/102445
5. If macOS says that "GitStar is damaged and can't be opened", or
   "Open Anyway" does not appear, remove the quarantine flag that macOS
   puts on downloaded files. The app is not signed by Apple, so macOS
   blocks it. Run this in Terminal after copying the app to
   Applications:

     xattr -dr com.apple.quarantine /Applications/GitStar.app

   If it still does not open, clear all extended attributes:

     xattr -cr /Applications/GitStar.app

   Then open GitStar from Applications again. Repeat this after
   installing a new version, including one installed by the self-update.

Linux x64
---------
Run "uname -m" and confirm that it reports x86_64. The
GitStar-x86_64-unknown-linux-gnu artifact contains three formats.
Run the commands from the download folder and replace the example
filenames with the actual filenames.

Debian or Ubuntu (.deb)
  sudo apt update
  sudo apt install git ./GitStar_amd64.deb
  Open GitStar from the application menu.

Fedora or another DNF-based distribution (.rpm)
  sudo dnf install git ./GitStar.x86_64.rpm
  Open GitStar from the application menu.

AppImage
  Install Git using your distribution's package manager, then run:
  chmod +x ./GitStar_amd64.AppImage
  ./GitStar_amd64.AppImage

  If you get a FUSE error, install your distribution's FUSE 2
  compatibility package (libfuse2 on Ubuntu 22.04 or libfuse2t64 on
  Ubuntu 24.04), or try:
  ./GitStar_amd64.AppImage --appimage-extract-and-run

Push keeps spinning
------------------
GitStar disables inherited interactive credential prompts, including VS
Code askpass. Configure a saved HTTPS credential in your Git credential
helper, or use an SSH remote with Settings > SSH. SSH keys are not used
for HTTPS URLs. Missing credentials now fail instead of opening a hidden
prompt. Restart the updated app to use this behavior.
Network Git operations stop after 120 seconds without console output;
progress resets the timer. A silent server operation may also time out.
After a timed-out push, check/fetch remote status before retrying, because
the server may already have accepted the changes.

Choose SSH or HTTPS (1.0.2)
---------------------------
Settings > Authentication > select a remote, or right-click a remote >
Authentication: SSH / HTTPS. Check the current URLs and preview, then Save.
The setting is per repository and preserves a separate Push destination.
Standard github.com URLs can be converted automatically; for custom SSH
aliases/ports, other hosts or multiple URLs, use Change URL instead.
SSH uses Settings > SSH (selected private key or agent). Connection test
checks the key; repository access still requires permission for that account.
HTTPS uses saved Git credentials and cannot use your SSH key. Choosing HTTPS
does not create a login or token.

macOS build note
----------------
Tauri may warn that the existing bundle identifier hu.gitstar.app ends
in .app. This naming recommendation does not prevent the build. Version
1.0.2 retains the identifier and existing settings location.

Cloning repositories
--------------------
Settings > Git > Git root folder > Browse sets the default clone parent.
Existing repositories are not moved. In Clone, paste the repository URL.
Choose SSH (GitHub) to use your selected SSH key/agent, HTTPS (GitHub) to
use saved Git credentials, or Use the supplied URL for other hosts/aliases.
An SSH key configured in Settings makes SSH the initial clone choice.

The parent folder has a Browse button. The folder name is inferred from
the URL and remains editable. Fill paths from repository resets the name
and restores the default parent (Git root, last clone parent, or active
repository parent). Check the actual URL and destination in the preview.
Paths now use native separators, fixing the previous macOS clone path bug.

Example with Git root /Users/zsolt/Dev:
  Input: https://github.com/zstarczali/SID-Studio.git
  Mode: SSH (GitHub)
  Clone URL: git@github.com:zstarczali/SID-Studio.git
  Destination: /Users/zsolt/Dev/SID-Studio
