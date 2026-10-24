#!/usr/bin/env bash
# Regenerates the tiny committed fixtures for Video/Audio Uploads (issue
# #51's AC). Run from anywhere; writes into this script's own directory.
# Needs ffmpeg built with libx264, libx265, libvpx-vp9 and libmp3lame.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

FF="ffmpeg -v error -y"

# --- video: allowed (H.264/AAC in MP4, within every test's limits) ---
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -f lavfi -i "sine=frequency=440:sample_rate=8000" \
  -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest video-allowed.mp4

# --- video: refused (MPEG-4 Part 2 isn't an accepted codec) ---
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -t 1 -c:v mpeg4 video-refused.mp4

# --- video: VFR (two frame rates concatenated; r_frame_rate != avg_frame_rate) ---
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -t 1 -c:v libx264 -pix_fmt yuv420p /tmp/vfr-part-a.mp4
$FF -f lavfi -i "testsrc=size=64x48:rate=20" -t 1 -c:v libx264 -pix_fmt yuv420p /tmp/vfr-part-b.mp4
printf "file '/tmp/vfr-part-a.mp4'\nfile '/tmp/vfr-part-b.mp4'\n" > /tmp/vfr-list.txt
$FF -f concat -safe 0 -i /tmp/vfr-list.txt -c copy -fflags +genpts video-vfr.mp4
rm -f /tmp/vfr-part-a.mp4 /tmp/vfr-part-b.mp4 /tmp/vfr-list.txt

# --- video: truncated (cut mid-stream; ffprobe can't read a full duration) ---
head -c 4000 video-allowed.mp4 > video-truncated.mp4

# --- video: misnamed (a real WebM/VP9 file, renamed .mp4: container mismatch) ---
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -t 1 -c:v libvpx-vp9 video-misnamed-source.webm
cp video-misnamed-source.webm video-misnamed.mp4
rm -f video-misnamed-source.webm

# --- video: browser-unplayable (HEVC in MKV; no browser plays this reliably) ---
# Short: already fits every test's default limits, so it passes through untrimmed.
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -t 1 -c:v libx265 -pix_fmt yuv420p video-unplayable-fits.mkv
# Long: breaks a typical max duration, and can't be trimmed without a preview.
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -t 6 -c:v libx265 -pix_fmt yuv420p video-unplayable-too-long.mkv

# --- audio: allowed (PCM in WAV) ---
$FF -f lavfi -i "sine=frequency=440:sample_rate=8000" -t 1 -c:a pcm_s16le audio-allowed.wav

# --- audio: refused (A-law PCM isn't an accepted WAV codec) ---
$FF -f lavfi -i "sine=frequency=440:sample_rate=8000" -t 1 -c:a pcm_alaw audio-refused.wav

# --- audio: misnamed (a real WAV file, renamed .mp3: container mismatch) ---
cp audio-allowed.wav audio-misnamed.mp3

# --- audio: cover art (ID3 embedded picture, reported by ffprobe as a
# video stream with disposition.attached_pic; must still be accepted) ---
$FF -f lavfi -i "color=size=16x16:color=red" -frames:v 1 /tmp/cover.png
$FF -f lavfi -i "sine=frequency=440:sample_rate=8000" -i /tmp/cover.png -t 1 \
  -map 0:a -map 1:v -c:a libmp3lame -c:v mjpeg -id3v2_version 3 \
  -metadata:s:v comment="Cover (front)" -disposition:v attached_pic \
  audio-cover-art.mp3
rm -f /tmp/cover.png

# --- video: cover art (same attached_pic carve-out as above, but on an
# MP4 that also carries a real H.264 video + AAC audio stream; no
# -shortest, which would otherwise cut the real streams to the cover
# image's own single frame) ---
$FF -f lavfi -i "color=size=16x16:color=red" -frames:v 1 /tmp/cover.png
$FF -f lavfi -i "testsrc=size=64x48:rate=5" -f lavfi -i "sine=frequency=440:sample_rate=8000" \
  -i /tmp/cover.png -map 0:v -map 1:a -map 2:v -t 1 \
  -c:v:0 libx264 -pix_fmt yuv420p -c:a aac -c:v:1 mjpeg -disposition:v:1 attached_pic \
  video-cover-art.mp4
rm -f /tmp/cover.png

ls -la *.mp4 *.mkv *.wav *.mp3 2>/dev/null
