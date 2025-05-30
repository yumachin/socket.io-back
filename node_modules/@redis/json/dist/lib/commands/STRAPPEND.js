"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, append, options) {
        parser.push('JSON.STRAPPEND');
        parser.pushKey(key);
        if (options?.path !== undefined) {
            parser.push(options.path);
        }
        parser.push((0, helpers_1.transformRedisJsonArgument)(append));
    },
    transformReply: undefined
};
//# sourceMappingURL=STRAPPEND.js.map