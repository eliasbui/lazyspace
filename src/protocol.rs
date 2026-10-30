//! The `lazy://` protocol the page loads icons, thumbnails and previews through. The frame is here: the scheme is
//! registered with every window and nothing is served yet, so every request is answered with 404. The hosts the
//! page may ask for (icon, thumb, app, file) are added with the code that serves them.

use wry::{
    RequestAsyncResponder,
    http::{Request, Response, StatusCode},
};

pub const SCHEME: &str = "lazy";

pub fn handle(_request: Request<Vec<u8>>, responder: RequestAsyncResponder) {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = StatusCode::NOT_FOUND;
    responder.respond(response);
}
