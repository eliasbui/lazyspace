// Finder's colour tags (src-tauri/src/features/tags.rs): a menu of the seven colours on the items selected, a sheet that
// edits them, and a section of the sidebar where each colour is a search of the whole Mac for it. The dots after a name
// are drawn by the panes from `Row.tags`.
import { openSheet, registry, type MenuItemDef } from '@/lib/registry';
import { TAG_ORDER, tagWord } from '@/lib/tags';
import { isLocal } from '@/lib/uri';
import { TagEditor } from './TagEditor';
import { TagsSection } from './TagsSection';
import { hasTag, setTag } from './tagging';

const colours: MenuItemDef[] = TAG_ORDER.map((colour) => ({
  id: `tag.${colour}`,
  label: tagWord(colour),
  group: 1,
  checked: (ctx) => ctx.entries.every((e) => hasTag(e, colour)),
  run: (ctx) => void setTag(ctx.pane, ctx.entries, colour, !ctx.entries.every((e) => hasTag(e, colour))),
}));

export function register(): void {
  registry.menu.add({
    id: 'tags',
    label: 'm.tags',
    icon: 'tag',
    group: 50,
    order: 5,
    when: (ctx) => ctx.count > 0 && ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)),
    submenu: [...colours, { id: 'tags.edit', label: 'editTags', group: 2, run: () => openSheet('tags') }],
  });

  registry.sheets.register({ id: 'tags', Component: TagEditor });
  registry.actions.set('editTags', () => openSheet('tags'));
  // At the foot of the sidebar, after the disks, where Finder keeps them.
  registry.sidebar.section({ id: 'tags', title: 'tagsTitle', order: 95, Component: TagsSection });
}
