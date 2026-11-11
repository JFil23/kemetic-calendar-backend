# Immutable live-source evidence

The manifest maps each deployed function's logical file paths to SHA-256 hashes.
Each distinct original file is retained once in `objects/<sha256>.source.gz`.
Decompressing an object must reproduce the original SHA-256. Compression and
content addressing reduce repeated copies of common shared modules; no original
source bytes or assertions are removed. The migration builder verifies each
object before substituting credential reads. These objects are archival test
fixtures, not another runtime feature owner. Do not edit or regenerate them to
make a gate pass. A new capture needs a separately dated manifest.
