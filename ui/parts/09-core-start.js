// The window starts once the app has said hello: the sidebar learns the well-known folders, then the panes come back
// as they were (layout.json) or open at home.
on("app.hello", async (d) => {
  if (d.windowRole !== "main" || Panes.all().length) return;
  await Sidebar.start();
  Panes.start(d.layout, d.uri);
  Toolbar.update();
  // The window comes back as it was without moving; from the next frame on, showing the sidebar and the like move.
  requestAnimationFrame(() => requestAnimationFrame(() => $("app").classList.remove("still")));
});
