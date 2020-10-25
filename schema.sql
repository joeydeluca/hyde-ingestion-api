CREATE TABLE `faces` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `face_id` VARCHAR(255) NOT NULL,
  `source_image_url` VARCHAR(1000) NOT NULL,
  `source_site_url` VARCHAR(1000) NOT NULL,
  `s3_name` VARCHAR(1000) NOT NULL,
  `s3_bucket` VARCHAR(255) NOT NULL,
  `created_date` DATETIME NOT NULL,
  `client_id` VARCHAR(100),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE INDEX idx_face_id ON faces(face_id);
CREATE UNIQUE INDEX idx_img_site ON faces(source_image_url, source_site_url);
CREATE UNIQUE INDEX idx_face_site ON faces(face_id, source_site_url);
