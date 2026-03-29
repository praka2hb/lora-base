import type { CharacterIdentity } from '../types.js';

export interface BuiltPrompts {
  positive: string;
  negative: string;
}

const CATEGORY_STYLES: Record<string, string[]> = {
  pokemon: ['wojak MS Paint meme style', 'flat colors', 'crude expressive shapes'],
  anime: ['wojak reaction meme exaggeration', 'flat colors', 'NOT clean anime'],
  game: ['retro gaming meme aesthetic', 'flat stylized', 'ironic HUD energy'],
  cartoon: ['MS Paint cartoon', 'wojak meme line art', 'flat meme colors'],
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
    'wojak feels-guy inspired MS Paint meme aesthetic',
    'consistent crude meme character design',
    'same character',
    scene,
    ...styleFragments,
    'flat expressive lighting',
    'talking to camera meme energy',
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
