import {
  CircleHalfIcon,
  DesktopIcon,
  FolderIcon,
  GearSixIcon,
  InfoIcon,
  KeyboardIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PuzzlePieceIcon,
  TerminalWindowIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { AccentName } from '@/services';

/**
 * The symbol and the tile colour of each page of Settings, by the word of its title, as System Settings draws its list; a
 * page a new feature adds gets the last one. The colour is one of the accents (`[data-accent]` in the stylesheet).
 */
const LOOK: Record<string, [Icon, Exclude<AccentName, 'system'>]> = {
  general: [GearSixIcon, 'graphite'],
  appearance: [CircleHalfIcon, 'graphite'],
  colorsIcons: [PaletteIcon, 'orange'],
  keyboard: [KeyboardIcon, 'graphite'],
  contextMenu: [ListBulletsIcon, 'blue'],
  finderTitle: [FolderIcon, 'blue'],
  searchTitle: [MagnifyingGlassIcon, 'graphite'],
  actionsTitle: [TerminalWindowIcon, 'green'],
  desktop: [DesktopIcon, 'blue'],
  about: [InfoIcon, 'graphite'],
};
const OTHER: [Icon, Exclude<AccentName, 'system'>] = [PuzzlePieceIcon, 'purple'];

export const lookOf = (title: string): [Icon, Exclude<AccentName, 'system'>] => LOOK[title] ?? OTHER;
