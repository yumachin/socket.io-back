"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, options) {
        parser.push('JSON.GET');
        parser.pushKey(key);
        if (options?.path !== undefined) {
            parser.pushVariadic(options.path);
        }
    },
    transformReply: helpers_1.transformRedisJsonNullReply
};
//# sourceMappingURL=GET.js.map