"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, path, value) {
        parser.push('JSON.MERGE');
        parser.pushKey(key);
        parser.push(path, (0, helpers_1.transformRedisJsonArgument)(value));
    },
    transformReply: undefined
};
//# sourceMappingURL=MERGE.js.map