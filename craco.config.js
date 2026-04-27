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
      return config;
    },
  },
};
