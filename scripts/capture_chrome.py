#!/usr/bin/env python3
"""Capture a docs screenshot from a Chrome window on macOS.

Only the Chrome window whose title contains --marker is captured (never the
whole screen), so other apps and other tabs can't end up in a screenshot. Set
the marker from the page before capturing, e.g.
    document.title = '[cap] ' + document.title
The browser frame (tabs, address bar) is cropped off using the page's
innerHeight, then the optional --clip rectangle (CSS pixels, relative to the
viewport) is applied.

Usage:
  python3 scripts/capture_chrome.py --viewport 1440x900 --out images/x.webp
  python3 scripts/capture_chrome.py --viewport 1440x900 --clip 240,80,900,500 \
      --out images/x.webp

Needs Screen Recording permission for the terminal/app that runs it. The
display is woken for a few seconds before each capture (caffeinate -u), since
macOS can't capture windows while it sleeps; a locked screen stays locked.

While the Claude in Chrome extension acts on the tab, Chrome shows a debugging
bar (the page is ~56 px shorter) and the extension draws a "Claude is working
here" pill and an orange glow over the page, outside the page's DOM, so CSS
can't hide them. Both go away a while after the extension's last action.
--wait-idle N retries for up to N seconds until the bar, the pill and the
glow are gone; pass the page's height without the debugging bar as --viewport.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

from PIL import Image

SWIFT_SOURCE = r'''
import CoreGraphics
import Foundation
let info = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
var out: [[String: Any]] = []
for w in info {
  guard let owner = w[kCGWindowOwnerName as String] as? String, owner.contains("Chrome") else { continue }
  if (w[kCGWindowLayer as String] as? Int ?? -1) != 0 { continue }
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  out.append(["id": w[kCGWindowNumber as String] as? Int ?? 0,
              "name": w[kCGWindowName as String] as? String ?? "",
              "width": b["Width"] as? Double ?? 0,
              "height": b["Height"] as? Double ?? 0])
}
let data = try! JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
'''


def window_list():
    cache = os.path.join(tempfile.gettempdir(), 'docs-capture')
    os.makedirs(cache, exist_ok=True)
    binary = os.path.join(cache, 'chrome-windows')
    if not os.path.exists(binary):
        source = os.path.join(cache, 'chrome-windows.swift')
        with open(source, 'w') as f:
            f.write(SWIFT_SOURCE)
        subprocess.run(['swiftc', '-O', source, '-o', binary], check=True)
    return json.loads(subprocess.run([binary], check=True, capture_output=True,
                                     text=True).stdout)


def overlay_visible(img, top, dpr):
    """True while Chrome's debugging bar or the extension's overlay shows."""
    rgb = img.convert('RGB')
    # The debugging bar sits under the toolbar, so the toolbar's colour carries
    # on below the line where the page should start.
    x = rgb.width - round(5 * dpr)
    if rgb.getpixel((x, top - round(3 * dpr))) == rgb.getpixel(
            (x, top + round(12 * dpr))):
        return True
    strip = rgb.crop((0, top, rgb.width, top + round(60 * dpr)))
    w, h = strip.size
    orange = 0
    # The pill sits at the top centre; the logo at the top left is orange too.
    for y in range(0, h, 4):
        for x in range(w // 4, w * 3 // 4, 6):
            r, g, b = strip.getpixel((x, y))
            if r > 170 and 70 < g < 150 and b < 120 and r - b > 80:
                orange += 1
    # The glow tints the page's top edge pink.
    edge = strip.getpixel((w // 2, 1))
    inner = strip.getpixel((w // 2, h - 1))
    return orange > 10 or (edge[0] - edge[2]) > (inner[0] - inner[2]) + 12


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--marker', default='[cap]',
                   help='text the target window title must contain')
    p.add_argument('--viewport', required=True,
                   help='page innerWidth x innerHeight in CSS px, e.g. 1440x900')
    p.add_argument('--clip', help='x,y,w,h in CSS px relative to the viewport')
    p.add_argument('--out', required=True, help='.webp or .png output path')
    p.add_argument('--max-width', type=int, default=1600,
                   help='downscale wider images to this many pixels')
    p.add_argument('--quality', type=int, default=90, help='WebP quality')
    p.add_argument('--wait-idle', type=int, default=0, metavar='SECONDS',
                   help='retry until the Claude in Chrome overlay is gone')
    args = p.parse_args()

    vw, vh = (int(v) for v in args.viewport.lower().split('x'))
    matches = [w for w in window_list() if args.marker in w['name']]
    if len(matches) != 1:
        sys.exit(f'Expected one Chrome window titled with {args.marker!r}, '
                 f'found {len(matches)}. Is the docs tab the active tab?')
    win = matches[0]

    # macOS can't capture windows while the display sleeps. A short
    # user-activity assertion wakes it (a locked screen stays locked); waking
    # takes a moment, so retry the capture a few times.
    deadline = time.time() + args.wait_idle
    while True:
        subprocess.Popen(['caffeinate', '-u', '-t', '8'])
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            raw_path = tmp.name
        try:
            for attempt in range(8):
                time.sleep(1)
                done = subprocess.run(['screencapture', '-l', str(win['id']),
                                       '-o', '-x', raw_path],
                                      capture_output=True)
                if done.returncode == 0 and os.path.getsize(raw_path) > 0:
                    break
            else:
                sys.exit('Could not capture the window (is the display '
                         'asleep?).')
            img = Image.open(raw_path)
            img.load()
        finally:
            os.unlink(raw_path)

        dpr = img.width / win['width']
        top = img.height - round(vh * dpr)
        if not args.wait_idle or not 0 < top < img.height:
            break
        if not overlay_visible(img, top, dpr):
            break
        if time.time() > deadline:
            sys.exit('The Claude in Chrome overlay is still on the page.')
        time.sleep(4)
    if abs(img.width - round(vw * dpr)) > 2 or not 0 < top < 250 * dpr:
        sys.exit(f'Window is {img.width / dpr:.0f}x{img.height / dpr:.0f} pt; '
                 f'it does not match a {vw}x{vh} viewport. Resize the window '
                 f'or pass the real innerWidth x innerHeight.')

    x, y, w, h = (0, 0, vw, vh) if not args.clip else (
        float(v) for v in args.clip.split(','))
    box = (round(x * dpr), top + round(y * dpr),
           round((x + w) * dpr), top + round((y + h) * dpr))
    shot = img.crop(box).convert('RGBA')
    # The window's rounded bottom corners are transparent; fill them white.
    shot = Image.alpha_composite(
        Image.new('RGBA', shot.size, (255, 255, 255, 255)), shot).convert('RGB')
    if shot.width > args.max_width:
        shot = shot.resize((args.max_width,
                            round(shot.height * args.max_width / shot.width)),
                           Image.LANCZOS)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    if args.out.endswith('.png'):
        shot.save(args.out, optimize=True)
    else:
        shot.save(args.out, 'WEBP', quality=args.quality, method=6)
    print(json.dumps({'out': args.out, 'width': shot.width,
                      'height': shot.height,
                      'bytes': os.path.getsize(args.out)}))


if __name__ == '__main__':
    main()
