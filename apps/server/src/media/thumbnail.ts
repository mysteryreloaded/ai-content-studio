// A ~480px WebP thumbnail via `Bun.Image` (issue #45's AC), for an image
// Asset or a video's poster frame. Kept apart from media.ts: this one
// never shells out to ffmpeg/ffprobe.

const THUMBNAIL_LONG_SIDE = 480;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Reads width/height without decoding the whole image. */
export async function imageDimensions(path: string): Promise<ImageDimensions> {
  const metadata = await new Bun.Image(path).metadata();
  return { width: metadata.width, height: metadata.height };
}

/** Target dimensions keeping aspect ratio with the long side at `THUMBNAIL_LONG_SIDE`. */
function thumbnailDimensions(source: ImageDimensions): ImageDimensions {
  if (source.width <= 0 || source.height <= 0) {
    return { width: THUMBNAIL_LONG_SIDE, height: THUMBNAIL_LONG_SIDE };
  }
  if (source.width >= source.height) {
    const width = Math.min(THUMBNAIL_LONG_SIDE, source.width);
    return {
      width,
      height: Math.round((width * source.height) / source.width),
    };
  }
  const height = Math.min(THUMBNAIL_LONG_SIDE, source.height);
  return { width: Math.round((height * source.width) / source.height), height };
}

/** Resizes `path` (an image or a video's poster frame) to a ~480px WebP buffer. */
export async function makeWebpThumbnail(path: string): Promise<Buffer> {
  const image = new Bun.Image(path);
  const dimensions = thumbnailDimensions(await imageDimensions(path));
  return image.resize(dimensions.width, dimensions.height).webp().buffer();
}
