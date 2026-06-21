const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target || !['major', 'minor', 'patch'].includes(target)) {
  console.error('Error: Please specify version bump type: major, minor, or patch.');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');

// Helper to bump version
function bump(versionStr, type) {
  const parts = versionStr.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: ${versionStr}`);
  }
  
  let [major, minor, patch] = parts;
  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else if (type === 'patch') {
    patch += 1;
  }
  
  return `${major}.${minor}.${patch}`;
}

// 1. Read root version
const rootPkgPath = path.join(rootDir, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version;
const newVersion = bump(currentVersion, target);

console.log(`Bumping version from ${currentVersion} to ${newVersion} (${target})...`);

// 2. Update package.json files if they exist
const packagePaths = [
  'package.json',
  'sdk/package.json',
  'agent/package.json',
  'cli/package.json',
  'ui/package.json'
];

packagePaths.forEach(relPath => {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    pkg.version = newVersion;
    fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`Updated ${relPath} to version ${newVersion}`);
  }
});

// 3. Update contract/Cargo.toml if it exists
const cargoPaths = [
  'contract/Cargo.toml',
  'contract-executor/Cargo.toml'
];
cargoPaths.forEach(relCargoPath => {
  const fullCargoPath = path.join(rootDir, relCargoPath);
  if (fs.existsSync(fullCargoPath)) {
    let content = fs.readFileSync(fullCargoPath, 'utf8');
    content = content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${newVersion}"`);
    fs.writeFileSync(fullCargoPath, content, 'utf8');
    console.log(`Updated ${relCargoPath} version to ${newVersion}`);
  }
});

// 4. Update Rust lib.rs constants if they exist
const libRsPaths = [
  'contract/src/lib.rs',
  'contract-executor/src/lib.rs'
];
libRsPaths.forEach(relLibPath => {
  const fullLibPath = path.join(rootDir, relLibPath);
  if (fs.existsSync(fullLibPath)) {
    let content = fs.readFileSync(fullLibPath, 'utf8');
    content = content.replace(/^pub const CONTRACT_VERSION:\s*&\s*str\s*=\s*"[^"]*";/m, `pub const CONTRACT_VERSION: &str = "${newVersion}";`);
    content = content.replace(/^pub const VERSION:\s*&\s*str\s*=\s*"[^"]*";/m, `pub const VERSION: &str = "${newVersion}";`);
    fs.writeFileSync(fullLibPath, content, 'utf8');
    console.log(`Updated ${relLibPath} version constant to ${newVersion}`);
  }
});

// 5. Update Cargo lockfiles
const cargoLockDirs = [
  'contract',
  'contract-executor'
];
const { execSync } = require('child_process');
cargoLockDirs.forEach(relDir => {
  const fullDir = path.join(rootDir, relDir);
  if (fs.existsSync(fullDir)) {
    try {
      console.log(`Updating Cargo.lock in ${relDir}...`);
      execSync('cargo update', {
        cwd: fullDir,
        env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}:/usr/local/bin:${process.env.HOME || ''}/.cargo/bin` },
        stdio: 'ignore'
      });
      console.log(`Successfully updated Cargo.lock in ${relDir}`);
    } catch (err) {
      // ignore
    }
  }
});

console.log(`Successfully bumped all version references to ${newVersion}`);
