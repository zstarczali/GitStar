GitStar – telepítési útmutató
============================

Letöltés
--------
A GitHub Actions sikeres „Build installers” futásánál az Artifacts részből
töltsd le a gépedhez tartozó ZIP-et, majd csomagold ki. Ha a telepítőket
GitHub Release-ből töltöd le, közvetlenül a megfelelő fájlt válaszd.

A GitStar a gépen telepített Git programot használja. A telepítés után
terminálban ellenőrizd a „git --version” paranccsal. Ha a GitStart már
megnyitottad a Git telepítése előtt, zárd be és indítsd újra.

Windows x64 és ARM64
--------------------
1. A Beállítások > Rendszer > Névjegy alatt keresd a Rendszer típusa sort.
2. x64 processzorhoz a GitStar-x86_64-pc-windows-msvc, ARM processzorhoz
   a GitStar-aarch64-pc-windows-msvc csomagban lévő NSIS .exe-t válaszd.
3. Telepítsd a Git for Windows megfelelő változatát a https://git-scm.com/
   oldalról. A telepítőben engedélyezd a Git használatát külső programokból
   is, hogy a GitStar megtalálja.
4. Indítsd el a GitStar .exe telepítőjét. Ha a WebView2 futtatókörnyezet
   hiányzik, a telepítő letölti, amihez internetkapcsolat szükséges.
   Az aláíratlan telepítőnél SmartScreen figyelmeztetés jelenhet meg.
   Ha ellenőrizted a fájl forrását, a „További információ” alatt keresd
   a „Futtatás mindenképpen” lehetőséget, ha a rendszer felajánlja.
5. A telepítés után a Start menüből indítsd el a GitStart.

macOS Apple Silicon (ARM64) és Intel (x64)
-----------------------------------------
1. Az Apple menü > A Mac névjegye ablakban ellenőrizd a chipet.
   Apple M sorozathoz a GitStar-aarch64-apple-darwin, Intelhez a
   GitStar-x86_64-apple-darwin csomagban lévő .dmg-t válaszd.
2. Ha a „git --version” a fejlesztői eszközök telepítését kéri, fogadd el,
   vagy indítsd a telepítést az „xcode-select --install” paranccsal.
3. Nyisd meg a .dmg-t, húzd a GitStar.app fájlt az Alkalmazások mappába,
   majd válaszd le a lemezképet.
4. Nyisd meg a GitStart az Alkalmazások mappából. Ha a Gatekeeper
   az ismeretlen fejlesztő miatt blokkolja, és ellenőrizted a letöltés
   forrását, az első indítási kísérlet után a Rendszerbeállítások >
   Adatvédelem és biztonság alatt válaszd a „Megnyitás mindenképp”
   (Open Anyway) lehetőséget, majd erősítsd meg a megnyitást.
   Apple útmutató: https://support.apple.com/en-ie/102445

Linux x64
---------
Az „uname -m” kimenete x86_64 legyen. A GitStar-x86_64-unknown-linux-gnu
csomagban három formátum található. A parancsokat a letöltött fájl
mappájában futtasd, és a példában szereplő fájlnevet cseréld a ténylegesre.

Debian vagy Ubuntu (.deb)
  sudo apt update
  sudo apt install git ./GitStar_amd64.deb
  Indítsd el a GitStart az alkalmazásmenüből.

Fedora vagy más DNF-alapú rendszer (.rpm)
  sudo dnf install git ./GitStar.x86_64.rpm
  Indítsd el a GitStart az alkalmazásmenüből.

AppImage
  Telepítsd a Git csomagot a disztribúciód csomagkezelőjével.
  chmod +x ./GitStar_amd64.AppImage
  ./GitStar_amd64.AppImage
  FUSE-hiba esetén telepítsd a disztribúciód FUSE 2 kompatibilitási
  csomagját (például Ubuntu 22.04-en libfuse2, 24.04-en libfuse2t64),
  vagy próbáld így: ./GitStar_amd64.AppImage --appimage-extract-and-run
