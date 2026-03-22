import type { CharacterIdentity } from '../types.js';

export interface BuiltPrompts {
  positive: string;
  negative: string;
}

const CATEGORY_STYLES: Record<string, string[]> = {
  pokemon: ['cartoon style', 'vibrant colors', 'cel shaded', 'Pokemon art style'],
  anime: ['anime style', 'anime art', 'vibrant colors', 'detailed anime'],
  game: ['cartoon style', 'video game art', 'vibrant colors', 'stylized'],
  cartoon: ['cartoon style', 'animated', 'vibrant colors', 'cel shaded'],
};

export function buildPrompts(character: CharacterIdentity, scene: string): BuiltPrompts {
  const charData = character.character;
  const category = charData?.category ?? 'cartoon';

  // Use character's visual_description first, fall back to influencer's, then generate from name
  const visualDesc = charData?.visual_description
    || character.visual_description
    || `${charData?.name ?? character.name}, cartoon character`;

  const styleFragments = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.cartoon;

  const positiveFragments = [
    `portrait of ${visualDesc}`,
    'consistent character design',
    'same character',
    scene,
    ...styleFragments,
    'cinematic lighting',
    'expressive',
    'talking to camera',
    'high quality',
    'sharp focus',
  ];

  const negative = [
    'blurry',
    'distorted',
    'different character',
    'extra limbs',
    'deformed',
    'bad anatomy',
    'low quality',
    'worst quality',
    'jpeg artifacts',
    'watermark',
    'text',
    'multiple characters',
    'clone',
    'duplicate',
    'disfigured',
    'mutation',
    'ugly',
    'cropped',
    'realistic human',
    'photo realistic',
  ].join(', ');

  return {
    positive: positiveFragments.join(', '),
    negative,
  };
}
