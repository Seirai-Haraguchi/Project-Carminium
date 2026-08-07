import io, sys

target, block, start_marker, start_line, end_line = sys.argv[1:6]
start_line = int(start_line)
end_line = int(end_line)

lines = io.open(target, encoding='utf-8').read().split('\n')
s = start_line - 1
e = end_line  # exclusive
assert start_marker in lines[s], 'start marker mismatch: %r' % lines[s]
blk = io.open(block, encoding='utf-8').read().rstrip('\n').split('\n')
out = lines[:s] + blk + lines[e:]
io.open(target, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
print('spliced %s: %d -> %d lines' % (target, len(lines), len(out)))
