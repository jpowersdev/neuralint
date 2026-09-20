# Third-party benchmark material

The neuralint implementation is MIT licensed. Some benchmark fixtures and derived artifacts are distributed under their upstream licenses instead.

## Home Assistant developer documentation

`benchmark/home-assistant/rules/` and policy excerpts in `benchmark/quality/fixtures/` contain machine-readable adaptations of the Home Assistant Integration Quality Scale documentation.

- Source: <https://github.com/home-assistant/developers.home-assistant>
- Pinned commit: `17a7d242991cd7a22d11087acfe60545fa58ee49`
- Changes: official titles and guidance were extracted, condensed, and transformed into neuralint rule artifacts.
- License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International; see [`home-assistant/LICENSE.developer-docs.md`](home-assistant/LICENSE.developer-docs.md).
- Per-rule source URLs are recorded in [`home-assistant/provenance.json`](home-assistant/provenance.json).

The generated rule adaptations are distributed under the same CC BY-NC-SA 4.0 license. No endorsement by Home Assistant is implied.

## Home Assistant Core

The Home Assistant patches and source excerpts in `benchmark/home-assistant/` and `benchmark/quality/fixtures/` derive from:

- Source: <https://github.com/home-assistant/core>
- Pinned commit: `40fcd7dc6b37781291745e3d6c39601563e87349`
- License: Apache License 2.0; see [`home-assistant/LICENSE.core.md`](home-assistant/LICENSE.core.md).

The synthetic regressions are neuralint benchmark fixtures and are not upstream Home Assistant changes or claims about upstream contributors.

## p-map

The patches and source excerpts in `benchmark/realistic/` derive from:

- Source: <https://github.com/sindresorhus/p-map>
- Pinned commit: `f0c43e358a449584c2045c89d1b9ae3cd5a9f293`
- Copyright: Sindre Sorhus
- License: MIT; see [`realistic/LICENSE.p-map`](realistic/LICENSE.p-map).

The synthetic regressions are neuralint benchmark fixtures and are not upstream p-map changes or claims about upstream contributors.

## Effect idiom guidance

`benchmark/effect-idioms-30/rules/` contains newly authored machine-readable adaptations of public Effect v4 guidance from:

- Effect-TS/effect `LLMS.md`, pinned at `3b155e3e24e42b603d48dff5d3280715944998f0`, MIT licensed.
- jpowersdev/effect-pi `EFFECT.md`, pinned at `2dc0f83136bb17bf2e77746b1e98186c57e49471`, MIT licensed.
- kitlangton/skills `skills/effect`, pinned at `22c35cb7fd29f931789253fc3c8eb142f2863a8a`, MIT licensed.

Exact URLs and per-rule mappings are recorded in [`effect-idioms-30/provenance.json`](effect-idioms-30/provenance.json). The rules and synthetic fixture code are neuralint experiment artifacts; they are not official Effect guidance and no upstream endorsement is implied. Private guidance and unlicensed third-party text are not included.