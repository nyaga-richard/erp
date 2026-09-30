"""Data-only file archives: reject links, special files, traversal and overwrites."""
import sys,tarfile,json,hashlib,os
from pathlib import Path,PurePosixPath
mode,archive,directory=sys.argv[1:]
root=Path(directory)
if mode=='pack':
 root=root.resolve(strict=True)
 files=[]
 for p in sorted(root.rglob('*')):
  st=p.lstat()
  if p.is_symlink() or (p.is_file() and st.st_nlink!=1):raise ValueError('Links are forbidden in storage backups')
  if p.is_dir():continue
  if not p.is_file():raise ValueError('Special files are forbidden in storage backups')
  files.append((p,p.relative_to(root).as_posix()))
 with tarfile.open(archive,'w') as tar:
  for p,name in files:tar.add(p,arcname=name,recursive=False)
elif mode=='restore':
 if root.exists():raise ValueError('Restore destination must not exist')
 # Validate the entire archive before creating the destination.
 with tarfile.open(archive,'r') as tar:
  members=tar.getmembers();seen=set();total=0
  for member in members:
   name=PurePosixPath(member.name)
   if name.is_absolute() or '..' in name.parts or '\\' in member.name or not member.name or member.name in seen:raise ValueError('Unsafe or duplicate archive path')
   if not (member.isfile() or member.isdir()):raise ValueError('Archive links/special entries forbidden')
   total+=member.size
   if total>int(os.environ.get('RESTORE_MAX_BYTES','10737418240')):raise ValueError('Restore exceeds configured size limit')
   seen.add(member.name)
  root.mkdir(mode=0o700,parents=False)
  for member in members:
   dest=root.joinpath(*PurePosixPath(member.name).parts)
   if member.isdir():dest.mkdir(mode=0o700,parents=True,exist_ok=True);continue
   dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   with tar.extractfile(member) as source,open(dest,'xb') as target:
    os.chmod(dest,0o600)
    while chunk:=source.read(1024*1024):target.write(chunk)
else:raise ValueError('Unknown file archive operation')
