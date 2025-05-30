"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, keys, path) {
        parser.push('JSON.MGET');
        parser.pushKeys(keys);
        parser.push(path);
    },
    transformReply(reply) {
        return reply.map(json => (0, helpers_1.transformRedisJsonNullReply)(json));
    }
};
//# sourceMappingURL=MGET.js.map