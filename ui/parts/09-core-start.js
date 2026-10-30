// The window starts once the app has said hello: the sidebar learns the well-known folders, then the panes come back
// as they were (layout.json) or open at home.
on("app.hello", async (d) => {
  if (d.windowRole !== "main" || Panes.all().length) return;
  await Sidebar.start();
  Panes.start(d.layout, d.uri);
  Toolbar.update();
});
