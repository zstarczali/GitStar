GitStar Installation Guide
==========================

Version 1.0.1
-------------
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
