#!/usr/bin/env bash
# PROTOTYPE media: tiny synthetic clips that stand in for Assets and sample Uploads.
# Run once: bash prototypes/model-page/make-media.sh (needs ffmpeg). build.ts inlines media/.
set -euo pipefail
cd "$(dirname "$0")/media"
F="ffmpeg -hide_banner -loglevel error -y"
TONE="aevalsrc=0.12*sin(2*PI*220*t)*(1+sin(2*PI*0.5*t))/2+0.08*sin(2*PI*330*t)+0.05*sin(2*PI*440*t+sin(2*PI*3*t)):s=44100:d=4"
ENC="-c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -c:a aac -b:a 48k -shortest -movflags +faststart"

clip() { # name, video filtergraph
  $F -f lavfi -i "$2" -f lavfi -i "$TONE" -t 4 $ENC "$1.mp4"
  $F -ss 1.2 -i "$1.mp4" -frames:v 1 -q:v 7 "$1.jpg"
}

clip aurora "nullsrc=s=256x144:r=24:d=4,geq=r='128+100*sin(X/19+T*1.7)+20*sin(Y/7)':g='110+90*sin(Y/23-T*1.3)+30*sin((X+Y)/41)':b='150+100*sin((X-Y)/31+T)',scale=512:288"
clip dusk "gradients=s=512x288:r=24:d=4:c0=0x1d2b64:c1=0xf8cdda:c2=0xff7e5f:c3=0x2b1055:nb_colors=4:speed=0.04"
clip fractal "mandelbrot=s=512x288:r=24:start_scale=1.2:end_scale=0.15:end_pts=96:inner=mincol,trim=duration=4"
clip bloom "life=s=128x72:r=24:mold=10:life_color=#ffd166:death_color=#0b2a2e:mold_color=#1f8a8a:ratio=0.2,scale=512:288:flags=neighbor"
clip tall "nullsrc=s=144x256:r=24:d=4,geq=r='120+110*sin(Y/17+T*2)':g='90+80*sin(X/13-T)':b='170+80*sin((X+Y)/23+T*1.5)',scale=288:512"
clip square "cellauto=s=192x192:r=24:rule=30:scroll=1:random_fill_ratio=0.5,format=gray,geq=lum='p(X,Y)':cb='128+60*sin(T*2)':cr='150',scale=384:384:flags=neighbor,trim=duration=4"

# Sample source video: 14 s, two simple figures dancing, longer than the 10 s limit so it needs a trim.
$F -f lavfi -i "gradients=s=384x216:r=24:d=14:c0=0x2a2f4f:c1=0x917fb3:speed=0.01" \
  -f lavfi -i "color=c=0xe63946:s=22x70:r=24:d=14" -f lavfi -i "color=c=0xf4c7a1:s=14x16:r=24:d=14" \
  -f lavfi -i "color=c=0x2ec4b6:s=22x70:r=24:d=14" -f lavfi -i "color=c=0x8d5524:s=14x16:r=24:d=14" \
  -f lavfi -i "aevalsrc=0.15*sin(2*PI*(196*pow(2\,floor(mod(t*2\,6))/6))*t):s=44100:d=14" \
  -filter_complex "[0][1]overlay=x='110+35*sin(2*t)':y='110+6*abs(sin(4*t))'[a];[a][2]overlay=x='114+35*sin(2*t)':y='92+6*abs(sin(4*t))'[b];[b][3]overlay=x='250+28*sin(2*t+1.5)':y='108+6*abs(sin(4*t+1))'[c];[c][4]overlay=x='254+28*sin(2*t+1.5)':y='90+6*abs(sin(4*t+1))',format=yuv420p[v]" \
  -map "[v]" -map 5 -t 14 $ENC dance.mp4

# Sample audio: 12 s, a simple melody.
$F -f lavfi -i "aevalsrc=0.18*sin(2*PI*(262*pow(2\,(floor(mod(t*2\,8))*2)/12))*t)*(1-mod(t*2\,1)*0.6):s=44100:d=12" -c:a libmp3lame -b:a 64k song.mp3

ls -la
