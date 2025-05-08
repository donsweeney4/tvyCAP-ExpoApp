// s3_utils.js
export async function getPresignedS3Url(filename) {
    try {
      const response = await fetch('http://mobile.quest-science.net/get_presigned_url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename }),
      });
  
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Server error: ${error.error || response.status}`);
      }
  
      const data = await response.json();
      return {
        uploadUrl: data.uploadUrl,
        publicUrl: data.publicUrl,
      };
    } catch (err) {
      console.error('❌ Error fetching presigned S3 URL:', err);
      throw err;
    }
  }
  