#!/bin/sh
# Mixes the narration onto the recording at the offsets in timeline.json -> ../demo.mp4
set -e
python3 - <<'P'
import json, subprocess
t = json.load(open('timeline.json'))
ins, fl = ['-i', t['video']], []
for i, s in enumerate(t['timeline']):
    ins += ['-i', f"{s['id']}.mp3"]; ms = int(s['t'] * 1000)
    fl.append(f"[{i+1}:a]adelay={ms}|{ms}[a{i}]")
n = len(t['timeline'])
fl.append(''.join(f'[a{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0,apad[a]')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', ';'.join(fl), '-map', '0:v', '-map', '[a]', '-t', str(round(t['total'], 2)),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '../demo.mp4'], check=True)
P
ffprobe -v error -show_entries format=duration,size -of default=nw=1 ../demo.mp4
