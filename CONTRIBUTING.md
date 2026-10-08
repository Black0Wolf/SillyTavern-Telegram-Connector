# Contributing Guide

Thank you for considering contributing to the SillyTavern Telegram Connector project! Here are some guidelines to help you take part in development.

## How to Contribute

### Reporting issues

If you find a bug or have a feature suggestion, please submit it via GitHub Issues:

1. Before submitting, search existing Issues to avoid duplicates
2. Use a clear title describing the issue
3. Describe the issue or suggestion in detail, providing where possible:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Error messages and logs
   - System environment info

### Submitting code

1. Fork this repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Pull Request guidelines

- Make sure the code follows the project's coding style
- Update the docs to reflect your changes
- Keep the PR focused on a single feature or fix
- Clearly explain what your changes do and why in the PR description

## Development Setup

### Prerequisites

- Node.js 14.0 or higher
- An installed SillyTavern instance

### Local development

1. Clone the repository:
   ```bash
   git clone https://github.com/qiqi20020612/SillyTavern-Telegram-Connector.git
   cd SillyTavern-Telegram-Connector
   ```

2. Set up the server:
   ```bash
   cd server
   npm install
   ```

3. Create a Telegram Bot:
   - Create a new Telegram Bot with [@BotFather](https://t.me/BotFather)
   - Get the Bot Token
   - Replace the TOKEN variable in `server.js`

4. Start the server:
   ```bash
   npm run dev
   ```

5. Install the extension into SillyTavern:
   - In SillyTavern, install the extension from a local file path
   - Or install via URL: `http://localhost:your-port/SillyTavern-Telegram-Connector`

## Code Style

- Use meaningful variable and function names
- Add comments where appropriate
- Follow standard JavaScript practices

## License

By submitting a Pull Request, you agree that your contributions will be released under the [GPL-3.0 license](LICENSE).
