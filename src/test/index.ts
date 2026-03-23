import * as fs from 'fs';
import * as path from 'path';
import * as Mocha from 'mocha';

function collectTestFiles(root: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            collectTestFiles(entryPath, files);
        } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

export async function run(): Promise<void> {
    const mocha = new Mocha.default({
        ui: 'tdd',
        timeout: 60000,
        color: true,
    });

    const testsRoot = path.resolve(__dirname);
    const setupPath = path.join(testsRoot, 'mocha-setup.js');
    if (fs.existsSync(setupPath)) {
        mocha.addFile(setupPath);
    }

    const testFiles = collectTestFiles(testsRoot);
    for (const file of testFiles) {
        mocha.addFile(file);
    }

    return new Promise((resolve, reject) => {
        try {
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}
