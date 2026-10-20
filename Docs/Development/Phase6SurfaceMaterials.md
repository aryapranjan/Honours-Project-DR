# Phase 6 Surface Materials

Version date: 2026-09-16. Pilot appearance, not visually approved for study use.

## Sources and processing

The researcher supplied two external photographs, each 5712 x 4284 pixels:

- Wall: `/Users/aryaranjan/Downloads/IMG_1669.jpeg`; SHA-256 `c93fccfd501df5087dcd1add4a2f2171905b5ca5fd0f129005e0e19cf0991be1`.
- Desk: `/Users/aryaranjan/Downloads/IMG_1670.jpeg`; SHA-256 `c5892f651c9841879b375e86fe87a7823a18e753f72abf00b9d29f093a6de763`.

The built-in image-generation/editing tool derives separate clean surface
textures using the originals as edit references. The researcher approved
removing marks, tags, and baked shadows. These are AI-edited appearance assets,
not metrically registered photographic reconstructions or participant data.
Original photographs remain unchanged. No Quest passthrough frames are captured,
saved or transmitted for this material workflow.

The supplied Room, Wall and Table FBX scans were inspected as references. Their
fragmented texture atlases and dense meshes are not imported into the runtime;
no new scan alignment or measured geometry is inferred from them. The existing
calibrated flat planes are retained. Blender is not needed for this treatment.

## Runtime assets

- `Assets/CollaborativeDR/DiminishedReality/Textures/WallSurface.png`
- `Assets/CollaborativeDR/DiminishedReality/Textures/DeskSurface.png`

Both generated files are `1448 x 1086` PNGs. Wall SHA-256 is
`692a16ff79e044c28f7ab16ba16586cbea2ddff012f12e7b3d16d498c034ceec`;
desk SHA-256 is
`259dc1e161c62edee3b14804ddbfce4dc699b07c091c4c3ed8463f8ec08523aa`.
Their deliberately low-detail surfaces are stretched by the quad UVs to each
target's calibrated dimensions; there are no directional features whose scale
or aspect is intended to represent measured geometry.

The texture import uses sRGB colour, no alpha, mipmaps, clamp wrapping,
trilinear filtering, 4x anisotropy, a 2048-pixel maximum, and Android ASTC 6x6
compression. Read/Write is disabled. Each target profile supplies its own
texture through the existing material property block; the shared material
stays neutral. The old `Phase6WhiteMask.mat` filename is retained to avoid
changing established asset references; it is not the source of target colour.

Geometry remains TV `1.60 x 1.46 m` at `(0.034, 0, 0.07) m` and keyboard
`0.55 x 0.35 m` at desk height with `(-90, 0, 0)` degrees rotation. Both use
full opacity and 5 mm inside-edge feathering. There is no keyboard box, new
controller shortcut, automatic exposure sampling, or change to trial timing.

## On-head colour matching

Phone photographs cannot guarantee the same exposure or white balance as live
Quest passthrough. Start with each profile's brightness/contrast at 1 and white
tint. Keep room lighting consistent, calibrate, then use the existing guarded
preview: Prepare, Show, Reveal and Hide, separately for TV and keyboard.

1. Compare the texture boundary with the adjacent real surface in both eyes.
2. If the mask is too bright/dark, adjust **Brightness** in the corresponding
   `TvDiminishedRealityProfile` or `KeyboardDiminishedRealityProfile` asset.
3. Adjust **Tint** for colour cast and **Contrast** only if surface detail is
   too pronounced. Keep opacity and tint alpha at 1 so the distractor stays hidden.
4. Save, rebuild with the Phase 6 build command, and reinstall for the next check.
   Texture, brightness, contrast and tint survive configuration/rebuilds.
5. Check both seated positions, head movement, edge coverage and sustained 72 FPS.
   Share the same final settings across both Quests; do not silently retain
   per-headset study adjustments.

Colour tuning cannot repair geometric parallax. If object edges reappear during
head motion, record the pose/angle and diagnose coverage separately. The current
recessed planes and material settings remain provisional until the physical
pilot and later second-Quest repeat pass.

## Final prompt set (built-in tool, not CLI)

### Wall

Use case: precise-object-edit. Asset: square base-colour surface texture for a Unity wall replacement plane. Edit target: the attached original wall photo IMG_1669.jpeg. Derive a face-on texture from ONLY the clear central painted wall. Remove the four AprilTags, their shadows, stains, and broad illumination gradients. Keep the wall's existing muted warm-grey colour and mid-grey photographic exposure, approximately sRGB RGB(153,150,140), NOT bright off-white or white. Preserve only extremely subtle, fine paint stipple at its original low contrast; do not exaggerate roughness or grain. Even diffuse illumination edge-to-edge, no perspective, no objects, no text, no borders, no vignette, no directional shading. Surface fills entire image. This is a clean photographic material texture, not a room image or rendered swatch.

### Desk

Use case: precise-object-edit. Asset: square base-colour surface texture for a Unity desk replacement plane. Edit target: the attached original desk photo IMG_1670.jpeg. Derive a face-on texture from the central clear matte laminate. Remove scratches, dirt, stains, dark bottom-right edge and broad illumination gradients. Keep the photo's neutral slightly warm grey and mid-grey exposure, approximately sRGB RGB(148,148,141), NOT bright white. The desk is smooth matte laminate: retain only barely perceptible microtexture, much smoother than painted wall, no prominent grain, stippling, orange peel or synthetic noise. Even diffuse illumination edge-to-edge, no perspective, no objects, text, borders, vignette, directional shadows or hotspot. Surface fills whole image, not a rendered material swatch.
