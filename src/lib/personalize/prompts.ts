// Prompt sinh ảnh — port nguyên văn từ pearl_compare/public/themes.js (BASE_PROMPT, GEMINI_PROMPT, khối theme, khối màu).
// Sửa prompt ở pearl_compare trước, rồi chép sang đây; đừng sửa lệch một phía.
// Hai luồng: 'gemini' cho gemini-3-pro-image (ảnh ref là IMAGE 1, văn xuôi), 'all' cho mọi model khác.

export const BASE_PROMPT = `GOAL:
A studio photograph of a finished, handmade luxury artwork: the pet from the uploaded photo recreated as a raised mosaic of real, identical round pearls, mounted in front of a painted canvas background inside an elegant gold frame.

REFERENCE:
Take only shape and color from the uploaded photo: the subject’s identity, breed traits, silhouette, proportions, pose, expression, markings, and color placement.
Discard the photo’s surface completely. Fur, hairs, whiskers, skin, and nose texture do not transfer; only their colors do.

PEARL MOSAIC (the physical object):
- The whole pet is made of real manufactured pearl beads, every one the same diameter, glued side by side in one flat layer.
- They sit in an orderly close-packed grid of straight and gently curved rows, about 50–70 pearls across the width of the face.
- Because they are real pearls, each one is complete, perfectly spherical, and evenly spaced: never cut, broken, squashed, oval, fused, overlapping, or piled.
- Each pearl is high-luster: a bright white catch-light, mirror-like reflections, and soft iridescent nacre.
- Pearls cannot form thin lines, so there are no hairs, whiskers, or strands anywhere on or around the pet.
- There are no microbeads, seed beads, glitter, sequins, crystal chips, or rhinestone fragments on the pet.

FEATURE MAPPING (same pearl size everywhere):
- Markings, shading, eyebrows, and ear interiors: pearls of a different color, never a different size.
- Nose: 15–25 separate glossy jet-black pearls with a peacock-green sheen, the same size as the rest, following the grid; the nostrils are two groups of darker pearls. It reads as black jewelry, not as a real nose and not as one single stone.
- Eyes: polished gemstone cabochons with a star highlight, each ringed by one row of same-size dark pearls.
- Mouth line and muzzle: rows of same-size dark and light pearls; the face outline is made only of round pearl edges.
- If a detail is too small for one pearl, simplify the detail; never shrink the pearl.
- Only accessories may carry larger faceted gems; the pet’s face and body never do.

{{THEME}}PAINTED BACKGROUND & PRESENTATION:
- The background is paint on canvas in the style set by the theme, with no pearls, beads, or rhinestones.
- The pearl pet stands out in front of it like a raised jewelry appliqué and is the clear focal point.
- Straight-on view, sharp focus across every pearl, soft even jewelry-display lighting.

FINAL CHECK:
Every pearl on the pet is whole, round, and the same size; there is no hair, whisker, fur, skin, or real nose texture anywhere; the background contains no beads.`;

export const GEMINI_PROMPT = `IMAGE 1 is the authority for the pet: its breed, face shape, proportions, pose, expression, markings, and exact coat colours.

Create a studio photograph of a finished luxury artwork: the pet from IMAGE 1 rebuilt as a raised mosaic of real pearls, mounted on a painted canvas inside an ornate gold frame. The square frame fills most of the image, seen straight-on, and the pearl pet is large and centred as the clear focal point.

The pet is made entirely of identical round pearls, all exactly the same size, like one strand of 6 mm pearls cut apart and glued side by side in neat, gently curving rows, about sixty pearls across the face. Every pearl is a complete, perfect sphere with a bright white catch-light and soft iridescent nacre. The coat colours and markings from IMAGE 1 are shown only by changing the colour of the pearls: cream, gold, brown, grey, or black pearls of that same size, following the coat pattern. The outline of the pet is a clean edge of round pearls, so the whole animal looks smooth, beaded, and jewel-like from ear tip to tail.

The face follows the same pearl grid. The nose is a small rounded patch built from about twenty of the same glossy jet-black pearls with a peacock-green sheen, with two slightly darker pearl groups for the nostrils. The eyes are two polished gemstone cabochons with a star highlight, each circled by a single ring of dark pearls. The mouth, lips, and any tongue are rows of the same pearls in dark, pink, or light shades. Small details are simplified into this grid, so every pearl on the face stays the same size as those on the body. Faceted gems appear only on the accessories.

{{THEME}}The background is a hand-painted oil painting on the canvas itself, flat paint with visible brushwork, so the glossy pearl pet stands out in front of it like a jewelry appliqué. Soft, even jewelry-display lighting and sharp focus show every pearl.

IDENTITY, POSE AND COAT COLOURS = IMAGE 1.
MATERIAL = IDENTICAL ROUND PEARLS OF ONE SIZE, EVERYWHERE ON THE PET, NOSE AND FACE INCLUDED.
BACKGROUND = PAINT ON CANVAS, IN THE STYLE OF THE THEME.`;

type Theme = { id: string; name: string; theme: string; gTheme: string };
export const THEMES: Theme[] = [
  {
    id: 'royal-starry', name: "Starry King",
    theme: `THEME: ROYAL PET + STARRY NIGHT

Background: a Van Gogh "The Starry Night" (1889) oil painting with thick impasto and swirling brushstrokes: cobalt and ultramarine swirling sky, glowing halo-ringed stars and moon, an ornate palace balcony or castle.

Subject styling: a regal king with a jeweled crown, royal cape, ornate collar, and gold filigree ornaments with sapphire accents.

Palette: royal blue, deep navy, sapphire, gold, ivory, warm glowing yellow.
Mood: noble, dignified, magical.`,
    gTheme: `The pet is dressed as a regal king, wearing a jeweled gold crown with sapphires, a royal-blue velvet cape with gold filigree trim, and an ornate jeweled collar. Behind it, the canvas is painted in the style of Van Gogh's "The Starry Night": thick impasto, a swirling cobalt and ultramarine sky, glowing halo-ringed stars and a crescent moon, and a palace balcony with a distant castle. The colours are royal blue, deep navy, sapphire, gold, ivory, and warm glowing yellow, and the mood is noble and magical.`,
  },
  {
    id: 'sunflower-queen', name: "Sunflower Queen",
    theme: `THEME: SUNFLOWER QUEEN

Background: a Van Gogh "Sunflowers" (1888) still-life oil painting with thick impasto: chrome-yellow and ochre sunflowers in a rustic earthenware vase against a warm yellow ground.

Subject styling: a graceful queen with a sunflower crown, a refined royal necklace, and an optional soft cape or shoulder jewel. Luxurious but light.

Palette: sunflower yellow, golden ochre, amber, honey gold, olive green, ivory, soft brown.
Mood: radiant, warm, feminine, queenly.`,
    gTheme: `The pet is a graceful queen, wearing a crown of sunflowers, a refined golden necklace, and a soft shoulder jewel. Behind it, the canvas is painted in the style of Van Gogh's "Sunflowers": thick impasto, chrome-yellow and ochre sunflowers in a rustic earthenware vase against a warm yellow ground. The colours are sunflower yellow, golden ochre, amber, honey gold, olive green, and ivory, and the mood is radiant, warm, and queenly.`,
  },
  {
    id: 'cafe-duke', name: "Café Terrace Duke",
    theme: `THEME: CAFÉ TERRACE DUKE

Background: a Van Gogh "Café Terrace at Night" (1888) oil painting with thick impasto: a glowing yellow café terrace and awning, cobblestones, street lamps, and a deep blue sky with flower-like stars.

Subject styling: a noble duke with a high collar, elegant coat or shoulder mantle, a brooch, and a sash or medallion.

Palette: café gold, warm yellow, midnight blue, deep teal, navy, ivory, bronze, with small ruby or sapphire accents.
Mood: sophisticated, romantic, aristocratic.`,
    gTheme: `The pet is a noble duke, wearing a high embroidered collar, an elegant shoulder mantle, a jeweled brooch, and a ceremonial sash with a medallion. Behind it, the canvas is painted in the style of Van Gogh's "Café Terrace at Night": thick impasto, a glowing yellow café terrace and awning, cobblestones, street lamps, and a deep blue sky with flower-like stars. The colours are café gold, warm yellow, midnight blue, deep teal, ivory, and bronze, and the mood is sophisticated and romantic.`,
  },
  {
    id: 'almond-prince', name: "Almond Blossom Prince",
    theme: `THEME: ALMOND BLOSSOM PRINCE

Background: a Van Gogh "Almond Blossom" (1890) oil painting with thick impasto: Japanese-print-inspired branches with delicate white blossoms against a luminous turquoise sky.

Subject styling: a youthful prince with an elegant collar, a ceremonial sash, a delicate jewel ornament, and a light princely circlet if it fits.

Palette: sky blue, pale turquoise, ivory, blush white, soft silver, pale gold, gentle brown.
Mood: serene, youthful, spring-like, princely.`,
    gTheme: `The pet is a youthful prince, wearing an elegant collar, a ceremonial sash, a delicate jewel ornament, and a light silver circlet. Behind it, the canvas is painted in the style of Van Gogh's "Almond Blossom": thick impasto, Japanese-print-inspired branches with delicate white blossoms against a luminous turquoise sky. The colours are sky blue, pale turquoise, ivory, blush white, soft silver, and pale gold, and the mood is serene and spring-like.`,
  },
  {
    id: 'wheatfield-general', name: "Wheatfield General",
    theme: `THEME: WHEATFIELD GENERAL

Background: a Van Gogh "Wheatfield with Crows" (1890) oil painting with thick impasto: sweeping wind-driven golden wheat under a turbulent deep-blue sky, with a strong horizon.

Subject styling: a heroic general with a decorated collar, a ceremonial sash, a shoulder mantle, and a medal or insignia. Brave and dignified, not aggressive.

Palette: wheat gold, warm yellow, ochre, burnt amber, olive green, sky blue, deep blue, ivory, antique gold.
Mood: bold, noble, commanding.`,
    gTheme: `The pet is a heroic general, wearing a decorated collar, a ceremonial sash, a shoulder mantle, and a gold medal. Behind it, the canvas is painted in the style of Van Gogh's "Wheatfield with Crows": thick impasto, sweeping wind-driven golden wheat under a turbulent deep-blue sky, with a strong horizon. The colours are wheat gold, ochre, burnt amber, olive green, deep blue, and antique gold, and the mood is bold, noble, and dignified.`,
  },
  {
    id: 'irises-duchess', name: "Irises Duchess",
    theme: `THEME: IRISES DUCHESS

Background: a Van Gogh "Irises" (1889) oil painting with thick impasto: rhythmic clusters of blue-violet irises with bold contours and sword-like green leaves.

Subject styling: an elegant duchess with a floral tiara, a lace-like collar, and a jewel necklace or brooch.

Palette: iris violet, indigo, sapphire, leaf green, soft lavender, ivory, silver, small gold accents.
Mood: graceful, floral, noble, feminine.`,
    gTheme: `The pet is an elegant duchess, wearing a floral tiara, a lace-like collar, and a jewel necklace with a brooch. Behind it, the canvas is painted in the style of Van Gogh's "Irises": thick impasto, rhythmic clusters of blue-violet irises with bold contours and sword-like green leaves. The colours are iris violet, indigo, sapphire, leaf green, soft lavender, ivory, and small gold accents, and the mood is graceful and floral.`,
  },
  {
    id: 'halloween-5d', name: "Halloween",
    theme: `THEME: HALLOWEEN

Background: a storybook-style Halloween painting: carved jack-o’-lanterns, black bats, a full moon, a haunted house silhouette, autumn leaves, candy corn, and candles.

Subject styling: a black-and-orange bow, bandana, or collar with small pumpkin, bat, or moon charms, and an optional small witch hat.

Palette: vivid orange, black, ivory, warm gold, deep plum, dark brown, moonlight cream.
Mood: festive, spooky, but cute and readable.`,
    gTheme: `The pet wears a black-and-orange bow or bandana with small pumpkin, bat, and moon charms, and a small witch hat. Behind it, the canvas is painted as a storybook Halloween night in soft oil brushwork: carved jack-o'-lanterns, black bats, a full moon, a haunted house silhouette, autumn leaves, and candles. The colours are vivid orange, black, ivory, warm gold, and deep plum, and the mood is festive, spooky, and cute.`,
  },
  {
    id: 'christmas-bg', name: "Christmas",
    theme: `THEME: CHRISTMAS

Background: a warm painterly Christmas interior: golden fairy lights, a glowing Christmas tree, candles or lanterns, a cozy wooden setting, red and gold accents, soft bokeh.

Subject styling: one Christmas accessory that fits the subject: a plaid scarf, a bow, a jeweled collar, or a small festive cape.

Palette: ruby red, forest green, ivory, champagne gold, warm bronze.
Mood: festive, cozy, luxurious.`,
    gTheme: `The pet wears one festive accessory that suits it, such as a red plaid scarf, a velvet bow, or a small jeweled collar. Behind it, the canvas is painted as a warm, storybook Christmas interior in soft oil brushwork: a glowing decorated tree, golden fairy lights melting into soft bokeh, candles, and a cozy wooden room with red and gold accents. The colours are ruby red, forest green, ivory, champagne gold, and warm bronze, and the mood is cozy and luxurious.`,
  },
  {
    id: 'ocean', name: "Luxury Ocean",
    theme: `THEME: LUXURY OCEAN

Background: a luminous ocean painting with flowing brushstrokes: waves, bubbles, coral, seaweed, shells, and starfish, richer around the lower and side areas. Use only the motifs that suit the composition.

Subject styling: optionally one subtle marine accessory, such as a seashell collar or a small starfish charm.

Palette: deep navy, cobalt, sapphire, turquoise, aqua, seafoam green, shell white, sandy champagne, restrained gold or silver.
Presentation outside the frame: a bright coastal setting with turquoise sea, pale sky, soft sunlight, and weathered light wood.
Mood: luminous, elegant, aquatic.`,
    gTheme: `The pet wears a subtle marine accessory, such as a seashell collar or a small starfish charm. Behind it, the canvas is painted as a luminous ocean scene with flowing brushstrokes: waves, bubbles, coral, seaweed, shells, and starfish, richer around the lower and side areas. The colours are deep navy, cobalt, turquoise, aqua, seafoam green, and shell white, and the mood is luminous and elegant.`,
  },
];

export type Lane = 'all' | 'gemini';
export const laneOf = (provider: string, model: string): Lane => (provider === 'gemini' && /^gemini-3-pro-image/.test(model) ? 'gemini' : 'all');

/** Prompt cho 1 style (theme id). Style lạ → prompt gốc không theme. */
export function buildPrompt(themeId: string | null, lane: Lane = 'all'): string {
  const t = THEMES.find((x) => x.id === themeId);
  const text = t ? (lane === 'gemini' ? t.gTheme || t.theme : t.theme) : '';
  return (lane === 'gemini' ? GEMINI_PROMPT : BASE_PROMPT).replace('{{THEME}}', text ? `${text}\n\n` : '');
}

/** Đặc điểm màu trích từ ảnh gốc (bước analyze). Text quyết định màu, ảnh quyết định hình. */
export type Analysis = { species: string; breed: string; colours: { region: string; colour: string }[]; eyes: string; nose: string; distinctive: string; portrait_box?: number[] };

export const FEATURES_HEAD = `PET COLOURS (read from the uploaded photo; the photo still decides every shape and position):`;
export function featuresBlock(a: Analysis | null): string {
  if (!a) return '';
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const kind = a.species && a.breed && !a.breed.toLowerCase().includes(a.species.toLowerCase()) ? ` ${a.species}` : '';
  const lines = [FEATURES_HEAD, `The pet is a ${a.breed || a.species}${kind}.`];
  if (a.colours?.length) lines.push(a.colours.map((c) => `${cap(c.region)}: ${c.colour}`).join('; ') + '.');
  lines.push(`Eyes: ${a.eyes}. Nose: ${a.nose}.`);
  if (a.distinctive && !/^none\.?$/i.test(a.distinctive.trim())) lines.push(`Recognisable detail to keep: ${a.distinctive}.`);
  return lines.join('\n');
}

/** Chèn khối màu sau REFERENCE (luồng chung) hoặc sau đoạn "IMAGE 1 is the authority…" (luồng Gemini). */
export function withFeatures(prompt: string, block: string): string {
  if (!block.trim() || prompt.includes(FEATURES_HEAD)) return prompt;
  const m = /^(PEARL MOSAIC|ARTWORK PLACEHOLDER)/m.exec(prompt);
  if (m) return `${prompt.slice(0, m.index)}${block.trim()}\n\n${prompt.slice(m.index)}`;
  const i = prompt.indexOf('\n\n');
  return i < 0 ? `${block.trim()}\n\n${prompt}` : `${prompt.slice(0, i + 2)}${block.trim()}\n\n${prompt.slice(i + 2)}`;
}
