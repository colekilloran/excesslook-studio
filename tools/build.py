# build.py - assembles studio.html from src/studio-src.html + kit + vendor.
# Every marker must occur exactly once or the build aborts before writing.
import sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_path = os.path.join(root, 'src', 'studio-src.html')
out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'studio.html')
src = open(src_path, encoding='utf-8').read()
rd = lambda *p: open(os.path.join(root, *p), encoding='utf-8').read()
parts = {
  '/*@KITCSS*/': rd('kit', 'ios-kit.css'),
  '/*@KITJS*/': rd('kit', 'ios-kit.js'),
  '/*@MUXER*/': '/* mp4-muxer 5.2.2 - MIT License - Copyright (c) 2023 Vanilagy - github.com/Vanilagy/mp4-muxer */\n' + rd('vendor', 'mp4-muxer.min.js'),
  '@LOGO_B64@': rd('vendor', 'logo.b64').strip().split(',', 1)[1],
}
for k, v in parts.items():
    n = src.count(k)
    if n != 1:
        sys.exit('ABORT: marker %s occurs %d times' % (k, n))
    if k != '@LOGO_B64@' and '</script' in v.lower():
        sys.exit('ABORT: %s contains </script' % k)
    src = src.replace(k, v)
open(out_path, 'w', encoding='utf-8').write(src)
print('wrote', out_path, len(src.encode('utf-8')), 'bytes')
