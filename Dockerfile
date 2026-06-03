# 1. Use a lightweight Node.js environment
FROM node:20-slim

# 2. Install FFmpeg (Crucial for VoxScript to work)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# 3. Set the working directory inside the server
WORKDIR /app

# 4. Copy your package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# 5. Copy the rest of your app's code
COPY . .

# 6. Build the Next.js production app
RUN npm run build

# 7. Expose the port and start the server
EXPOSE 3000
CMD ["npm", "start"]