import * as assert from 'assert';
import * as os from 'os';
import { redactLogMessage } from '../../logging';

suite('[Unit] R language logging', () => {
    test('redacts credentials and home paths at the language sink boundary', () => {
        assert.strictEqual(
            redactLogMessage(
                `Bearer abc bearer_token=xyz --access-token=secret ${os.homedir()}/project`,
            ),
            'Bearer <redacted> bearer_token=<redacted> --access-token=<redacted> <home>/project',
        );
    });
});
