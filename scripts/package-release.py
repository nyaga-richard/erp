"""Portable source/docs release; deliberately exclude credentials, mail and runtime state."""
from pathlib import Path
import hashlib, json, zipfile
root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
dest = root.parent / f'karibu-erp-foundation-v{version}.zip'
if dest.exists():
    raise SystemExit('Release archive already exists; choose a new reviewed package version before packaging.')
excluded_dirs = {'.git', '.cache', '.runtime', '.arena', 'node_modules', 'build', 'dist', '__pycache__', '.venv', '.next', 'backups'}
excluded_files = {'.env', 'DEMO_ACCESS.md', '.DS_Store', 'tsconfig.tsbuildinfo'}
files = [p for p in root.rglob('*') if p.is_file()
         and not excluded_dirs.intersection(p.relative_to(root).parts)
         and p.name not in excluded_files and p.suffix not in {'.log', '.zip', '.backup', '.pgdump', '.erpbackup', '.tar'}
         and not (p.name.startswith('.env') and not p.name.endswith('.example'))]
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in sorted(files):
        archive.write(p, Path(root.name) / p.relative_to(root))
digest = hashlib.sha256(dest.read_bytes()).hexdigest()
dest.with_suffix('.zip.sha256').write_text(f'{digest}  {dest.name}\n')
print(f'{dest.name}: {len(files)} files, {dest.stat().st_size:,} bytes\nSHA256 {digest}')
