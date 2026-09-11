// Heap for the type-checker child process (MB). Override per machine with
// TYPE_CHECK_MEMORY_MB if needed.
const TYPE_CHECK_MEMORY_MB = Number(process.env.TYPE_CHECK_MEMORY_MB) || 6144;

module.exports = {
  webpack: {
    configure: (config) => {
      // Allow ESM packages (e.g. @mui/x-date-pickers) that omit file extensions in imports
      config.module.rules.push({
        test: /\.m?js$/,
        include: /node_modules/,
        resolve: {
          fullySpecified: false,
        },
      });
      // Type checker memory (2026-09-11): CRA's ForkTsCheckerWebpackPlugin runs
      // `tsc` in a child process capped at fork-ts-checker's default 2048 MB.
      // This codebase needs more — hosting builds died with "JavaScript heap
      // out of memory" in that child (not webpack; NODE_OPTIONS doesn't reach
      // it), failing roughly every other deploy. Raise the child's cap.
      for (const plugin of config.plugins || []) {
        const opts = plugin && plugin.options;
        if (opts && opts.typescript && opts.typescript.typescriptPath) {
          opts.typescript.memoryLimit = TYPE_CHECK_MEMORY_MB;
        }
      }
      return config;
    },
  },
};
