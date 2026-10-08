{ pkgs ? import <nixpkgs> {
    config = {
      allowUnfree = true;
      android_sdk.accept_license = true;
    };
  } }:

let
  androidComposition = pkgs.androidenv.composeAndroidPackages {
  platformVersions = [ "36" ];

  buildToolsVersions = [
    "35.0.0"
    "36.0.0"
  ];

  includeEmulator = false;
  includeSystemImages = false;
  includeNDK = false;
};

  androidSdk = androidComposition.androidsdk;
in
pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    pnpm
    jdk21
    androidSdk
    android-tools
  ];

  ANDROID_HOME = "${androidSdk}/libexec/android-sdk";
  ANDROID_SDK_ROOT = "${androidSdk}/libexec/android-sdk";

  shellHook = ''
    export JAVA_HOME="${pkgs.jdk21}"
    export PATH="$ANDROID_HOME/platform-tools:$PATH"

    echo ""
    echo "Tsundoku — environnement de développement"
    echo "Node    : $(node --version)"
    echo "pnpm    : $(pnpm --version)"
    echo "Java    : $(java -version 2>&1 | head -n 1)"
    echo "Android : $ANDROID_HOME"
    echo ""
  '';
}
