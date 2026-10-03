import type { Expression } from "blobatar"
import {
  happy,
  idle,
  love,
  mad,
  sad,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  thinking,
  unsure,
  wink,
  scared,
} from "blobatar/expression"
import { AvatarExpression, AvatarShape, AvatarTone } from "@blindmusic/shared"

export {
  AvatarExpression,
  AvatarShape,
  AvatarTone,
  SHAPE_TRAIT,
  TONE_VALUE,
  decodeAvatar,
  encodeAvatar,
  type AvatarConfig,
} from "@blindmusic/shared"

export const SHAPE_LABEL: Record<AvatarShape, string> = {
  [AvatarShape.Round]: "Rond",
  [AvatarShape.Organic]: "Galet",
  [AvatarShape.Boxy]: "Carré",
  [AvatarShape.Capsule]: "Gélule",
  [AvatarShape.Nub]: "Bouclé",
  [AvatarShape.Cloud]: "Nuage",
  [AvatarShape.Droplet]: "Goutte",
  [AvatarShape.Hexagon]: "Hexagone",
  [AvatarShape.Sun]: "Soleil",
  [AvatarShape.Triangle]: "Triangle",
}

export const TONE_LABEL: Record<AvatarTone, string> = {
  [AvatarTone.Pastel]: "Pastel",
  [AvatarTone.Pale]: "Neutre",
  [AvatarTone.Mid]: "Moyen",
  [AvatarTone.Deep]: "Profond",
  [AvatarTone.Bright]: "Vif",
  [AvatarTone.Ink]: "Encre",
}

export const EXPRESSION_VALUE: Record<AvatarExpression, Expression> = {
  [AvatarExpression.Idle]: idle,
  [AvatarExpression.Happy]: happy,
  [AvatarExpression.Wink]: wink,
  [AvatarExpression.Surprised]: surprised,
  [AvatarExpression.Love]: love,
  [AvatarExpression.Smug]: smug,
  [AvatarExpression.Shy]: shy,
  [AvatarExpression.Thinking]: thinking,
  [AvatarExpression.Sleepy]: sleepy,
  [AvatarExpression.Unsure]: unsure,
  [AvatarExpression.Sad]: sad,
  [AvatarExpression.Scared]: scared,
  [AvatarExpression.Mad]: mad,
  [AvatarExpression.Sick]: sick,
}

export const EXPRESSION_LABEL: Record<AvatarExpression, string> = {
  [AvatarExpression.Idle]: "Neutre",
  [AvatarExpression.Happy]: "Joyeux",
  [AvatarExpression.Wink]: "Clin d'œil",
  [AvatarExpression.Surprised]: "Surpris",
  [AvatarExpression.Love]: "Amoureux",
  [AvatarExpression.Smug]: "Malin",
  [AvatarExpression.Shy]: "Timide",
  [AvatarExpression.Thinking]: "Pensif",
  [AvatarExpression.Sleepy]: "Endormi",
  [AvatarExpression.Unsure]: "Perplexe",
  [AvatarExpression.Sad]: "Triste",
  [AvatarExpression.Scared]: "Effrayé",
  [AvatarExpression.Mad]: "Fâché",
  [AvatarExpression.Sick]: "Malade",
}
