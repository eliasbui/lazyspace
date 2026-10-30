//! Draws the LazySpace app icon into assets/: `assets/icon-art.png`, a picture of the icon an image model made on a
//! plain background, has its tile found, cut out along Apple's icon grid and given a shadow, once at 1024 for the
//! bundle and once at 256 for the window. Run once with `cargo run --example make_icons`. Everything is supersampled
//! four times and box-filtered down, so the rounded edges stay smooth. `LAZYSPACE_ICON_ART` names another picture to
//! try.

use std::{fs::File, io::BufWriter, path::Path};

const SS: usize = 4;

fn main() {
    let path = std::env::var("LAZYSPACE_ICON_ART").unwrap_or_else(|_| "assets/icon-art.png".into());
    let Some(art) = Art::load(&path) else {
        eprintln!("{path} is not an RGB or RGBA PNG with a tile on a plain background");
        std::process::exit(1);
    };
    write_png("assets/icon.png", app_icon(1024, &art));
    write_png("assets/icon-256.png", app_icon(256, &art));
    println!("wrote assets/icon.png and assets/icon-256.png");
}

/// Colour at a pixel, with alpha, before downsampling. `(x, y)` are in the supersampled grid of side `n*SS`.
type Shade<'a> = Box<dyn Fn(f32, f32) -> [f32; 4] + 'a>;

/// A picture of the icon on a plain background, and the box of its tile in it.
struct Art {
    width: usize,
    rgb: Vec<[f32; 3]>,
    tile: (f32, f32, f32, f32),
}

impl Art {
    /// The picture at `path`, None when there is none. Its tile is what differs from the colour of its corner.
    fn load(path: &str) -> Option<Art> {
        let mut reader = png::Decoder::new(std::io::Cursor::new(std::fs::read(path).ok()?)).read_info().ok()?;
        let mut buf = vec![0; reader.output_buffer_size()?];
        let info = reader.next_frame(&mut buf).ok()?;
        let channels = match info.color_type {
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            _ => return None,
        };
        let (width, height) = (info.width as usize, info.height as usize);
        let rgb: Vec<[f32; 3]> = buf[..width * height * channels].chunks(channels).map(|p| [p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0]).collect();
        let corner = rgb[2 * width + 2];
        let (mut x0, mut y0, mut x1, mut y1) = (width, height, 0, 0);
        for y in 0..height {
            for x in 0..width {
                let p = rgb[y * width + x];
                if (0..3).map(|k| (p[k] - corner[k]).abs()).fold(0.0, f32::max) > 0.16 {
                    (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
                }
            }
        }
        println!("{path}: tile {x0},{y0} to {x1},{y1} in {width}x{height}");
        (x1 > x0 && y1 > y0).then(|| Art { width, rgb, tile: (x0 as f32, y0 as f32, x1 as f32, y1 as f32) })
    }

    /// The colour at `(u, v)` of the tile, each 0 to 1, a little inside its edge so none of the background shows.
    fn at(&self, u: f32, v: f32) -> [f32; 3] {
        let inset = 0.035;
        let (x0, y0, x1, y1) = self.tile;
        let x = x0 + (inset + u * (1.0 - 2.0 * inset)) * (x1 - x0);
        let y = y0 + (inset + v * (1.0 - 2.0 * inset)) * (y1 - y0);
        let (xi, yi) = (x.floor() as usize, y.floor() as usize);
        let (fx, fy) = (x - xi as f32, y - yi as f32);
        let px = |x: usize, y: usize| self.rgb[y.min(self.rgb.len() / self.width - 1) * self.width + x.min(self.width - 1)];
        let top = mix(px(xi, yi), px(xi + 1, yi), fx);
        let bottom = mix(px(xi, yi + 1), px(xi + 1, yi + 1), fx);
        mix(top, bottom, fy)
    }
}

fn app_icon(size: usize, art: &Art) -> Image {
    let big = size * SS;
    let s = big as f32;
    // Apple's grid for a macOS icon: a body of 824 in 1024 with a 185 corner, so the Dock shows it as it is, among
    // the others, and a shadow under it in the margin.
    let (c, half, radius) = (s * 0.5, s * 412.0 / 1024.0, s * 185.4 / 1024.0);
    let edge = SS as f32 * 0.75;
    let shade: Shade = Box::new(move |x, y| {
        let d = rounded_rect(x - c, y - c, half, radius);
        let body = smooth(edge, -edge, d);
        let shadow = smooth(s * 0.028, -s * 0.004, rounded_rect(x - c, y - c - s * 0.016, half * 0.985, radius)) * 0.24;
        if body <= 0.0 {
            return [0.0, 0.0, 0.0, shadow];
        }
        // The body over its shadow.
        let alpha = body + shadow * (1.0 - body);
        let rgb = art.at((x - (c - half)) / (2.0 * half), (y - (c - half)) / (2.0 * half));
        [rgb[0] * body / alpha, rgb[1] * body / alpha, rgb[2] * body / alpha, alpha]
    });
    render(big, size, &shade)
}

/// The signed distance to a rounded square of half-side `half` and corner `r` centred on the origin, negative inside.
fn rounded_rect(x: f32, y: f32, half: f32, r: f32) -> f32 {
    let dx = x.abs() - (half - r);
    let dy = y.abs() - (half - r);
    dx.max(0.0).hypot(dy.max(0.0)) + dx.max(dy).min(0.0) - r
}

/// A smoothstep from 0 at `edge0` to 1 at `edge1` (either order).
fn smooth(edge0: f32, edge1: f32, v: f32) -> f32 {
    let t = ((v - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

struct Image {
    size: usize,
    rgba: Vec<u8>,
}

/// Renders the shade at `big = size*SS`, then box-filters down to `size`, straight-alpha to premultiplied and back
/// so the edges do not darken.
fn render(big: usize, size: usize, shade: &Shade<'_>) -> Image {
    let mut src = vec![0.0f32; big * big * 4];
    for y in 0..big {
        for x in 0..big {
            let c = shade(x as f32 + 0.5, y as f32 + 0.5);
            let i = (y * big + x) * 4;
            src[i] = c[0] * c[3];
            src[i + 1] = c[1] * c[3];
            src[i + 2] = c[2] * c[3];
            src[i + 3] = c[3];
        }
    }
    let mut rgba = vec![0u8; size * size * 4];
    let n = (SS * SS) as f32;
    for y in 0..size {
        for x in 0..size {
            let mut acc = [0.0f32; 4];
            for sy in 0..SS {
                for sx in 0..SS {
                    let i = (((y * SS + sy) * big) + (x * SS + sx)) * 4;
                    for k in 0..4 {
                        acc[k] += src[i + k];
                    }
                }
            }
            let a = acc[3] / n;
            let o = (y * size + x) * 4;
            let unmul = |c: f32| if a > 0.0 { ((c / n) / a * 255.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
            rgba[o] = unmul(acc[0]);
            rgba[o + 1] = unmul(acc[1]);
            rgba[o + 2] = unmul(acc[2]);
            rgba[o + 3] = (a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    Image { size, rgba }
}

fn write_png(path: &str, image: Image) {
    let file = BufWriter::new(File::create(Path::new(path)).expect("create png"));
    let mut encoder = png::Encoder::new(file, image.size as u32, image.size as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().expect("header").write_image_data(&image.rgba).expect("pixels");
}
