// The panes, the heart of the window. Loading this module installs them behind `panes` (src/lib/panes-api.ts) and starts
// listening to the host and to drops; `PaneGrid` draws them and starts them once the app has said hello.
import { installPanes } from '@/lib/panes-api';
import { listenDrops } from './dnd/drop';
import { manager } from './manager';

installPanes(manager);
manager.listen();
listenDrops();

export { PaneGrid } from './PaneGrid';
