// The panes, the heart of the window. Loading this module installs them behind `panes` (src/lib/panes-api.ts), adds the
// core's items to the context menu and starts listening to the host; `PaneGrid` draws them and starts them once the app
// has said hello.
import { installPanes } from '@/lib/panes-api';
import { listenDrops } from './dnd/drop';
import { manager } from './manager';
import { registerCoreMenu } from './menu/items';

installPanes(manager);
manager.listen();
listenDrops();
registerCoreMenu();

export { PaneGrid } from './PaneGrid';
