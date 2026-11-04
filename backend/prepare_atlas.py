"""One-time: shrink the 10um P10 annotation (5 GB) into a browser-sized 20um .nii.gz.

Labels are remapped to compact uint16 indices (0 = background); labels.json maps
index -> original ontology ID. Run: .venv/Scripts/python prepare_atlas.py
"""
import json, sys
from pathlib import Path
import nibabel as nib
import numpy as np

src = Path(sys.argv[1] if len(sys.argv) > 1 else "data/DeMBA_P10_KimLabDevCCFv001_10um.nii")
out = Path(__file__).parent.parent / "public" / "atlas"
out.mkdir(parents=True, exist_ok=True)
step = 2  # 10um -> 20um (nearest neighbour, safe for labels)

img = nib.load(src, mmap=True)
vol = img.dataobj
# Read slab-by-slab along the contiguous last axis to keep memory low
small = np.stack([np.asarray(vol[::step, ::step, k]) for k in range(0, vol.shape[2], step)], axis=2)

ids, compact = np.unique(small, return_inverse=True)
assert ids[0] == 0 and len(ids) < 65536
compact = compact.reshape(small.shape).astype(np.uint16)

affine = img.affine.copy()
affine[:3, :3] *= step
nib.save(nib.Nifti1Image(compact, affine), out / "p10_annotation_20um.nii.gz")
(out / "labels.json").write_text(json.dumps(ids.tolist()))
print(f"{compact.shape}, {len(ids) - 1} regions -> {out}")
