Tsundoku adaptive icon
Background: solid slate #2E343E (values/ic_launcher_background.xml), filling the whole launcher mask.
Foreground: the artwork (rounded square, cream margin removed) at 70 % of the 108 dp canvas, centred,
so no cream margin shows on a rounded-square mask. Circular masks crop the corners slightly.
Legacy ic_launcher.png / ic_launcher_round.png are generated from the same artwork.
Source: play-store-icon-512.png. This pack does not modify splash resources.

Splash screen
- drawable*/splash.png (all densities / orientations): cream background (#F8F4EB) with the logo centred,
  never stretched, at 46 % of the shorter side.
- drawable-nodpi/splash_icon.png: Android 12+ splash icon (288 dp canvas); the logo stays inside the
  192 dp circle the system shows. Wired in values/styles.xml (windowSplashScreenAnimatedIcon).
