import * as fs from 'fs';
import * as path from 'path';

// The extension root directory.
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

// Read the package.json file.
const packageJson = JSON.parse(
    fs.readFileSync(path.join(EXTENSION_ROOT_DIR, 'package.json'), 'utf8'),
) as {
    positron?: {
        minimumRVersion?: string;
    };
};

// The minimum supported version of R.
export const MINIMUM_R_VERSION = packageJson.positron?.minimumRVersion ?? '4.2.0';
